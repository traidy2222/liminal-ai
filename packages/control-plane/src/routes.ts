import { Router, type Request, type Response } from "express";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ControlPlaneConfig, PaidTier } from "./config.js";
import { isAllowedPortalReturnUrl, stripePriceIdForTier } from "./config.js";
import { licenseVerifyResponse } from "./license_service.js";
import { createAuthMiddleware, type AuthedRequest } from "./auth.js";
import {
  ensureProfile,
  getActiveLicenseForUser,
  isStripeEventProcessed,
  recordStripeEvent,
} from "./supabase_admin.js";
import { handleCheckoutCompleted, handleSubscriptionEvent } from "./stripe_handlers.js";
import { createRateLimiter } from "./rate_limit.js";
import { logServerError, newCorrelationId, sendInternalError } from "./http_errors.js";
import { createProRoutes } from "./pro_routes.js";
import { createTeamRoutes } from "./team_routes.js";
import { createTeamBusRoutes } from "./team_bus_routes.js";
import { randomUUID } from "node:crypto";
import { ensureOrganization, addOrgMember } from "./org_auth.js";
import { createTeamOrgRoutes } from "./team_org_routes.js";

const PAID_TIERS = ["pro", "team", "enterprise"] as const;

function isPaidTier(t: string): t is PaidTier {
  return (PAID_TIERS as readonly string[]).includes(t);
}

export interface RouteDeps {
  config: ControlPlaneConfig;
  db: SupabaseClient;
  stripe: Stripe;
}

const licenseVerifyRateLimit = createRateLimiter({ windowMs: 60_000, max: 30 });

export function createRoutes(deps: RouteDeps): Router {
  const { config, db, stripe } = deps;
  const router = Router();
  const requireAuth = createAuthMiddleware(config);

  router.get("/health", (_req, res) => {
    res.json({ ok: true, service: "liminal-control-plane" });
  });

  /** Offline-verifiable license check (no auth — harness + dashboard copy-paste). */
  router.post("/api/license/verify", licenseVerifyRateLimit, (req, res) => {
    const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
    if (!token) {
      res.status(400).json({ error: "token required" });
      return;
    }
    res.json(licenseVerifyResponse(token, config.licensePublicKeyPem));
  });

  /** Current user's active license token (requires Supabase session JWT). */
  router.get("/api/license/me", requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const row = await getActiveLicenseForUser(db, req.userId!);
      if (!row) {
        res.json({ licensed: false, tier: "community", token: null });
        return;
      }
      const summary = licenseVerifyResponse(row.token, config.licensePublicKeyPem);
      res.json({
        licensed: summary.ok,
        tier: row.tier,
        token: row.token,
        expiresAt: row.expires_at,
        licenseSub: row.license_sub,
        status: summary.status,
        entitlements: summary.entitlements,
      });
    } catch (err) {
      const correlationId = newCorrelationId();
      logServerError("GET /api/license/me", err, correlationId);
      sendInternalError(res, correlationId);
    }
  });

  /** Start Stripe Checkout for a paid tier. */
  router.post("/api/billing/checkout", requireAuth, async (req: AuthedRequest, res: Response) => {
    const tierRaw = typeof req.body?.tier === "string" ? req.body.tier.trim().toLowerCase() : "";
    if (!isPaidTier(tierRaw)) {
      res.status(400).json({ error: "tier must be pro, team, or enterprise" });
      return;
    }
    try {
      const priceId = stripePriceIdForTier(config, tierRaw);
      await ensureProfile(db, req.userId!, req.userEmail);

      let customerId: string | undefined;
      const { data: profile } = await db
        .from("profiles")
        .select("stripe_customer_id")
        .eq("id", req.userId!)
        .maybeSingle();
      if (profile?.stripe_customer_id) {
        customerId = profile.stripe_customer_id;
      } else {
        const customer = await stripe.customers.create({
          email: req.userEmail ?? undefined,
          metadata: { supabase_user_id: req.userId! },
        });
        customerId = customer.id;
        await db
          .from("profiles")
          .update({ stripe_customer_id: customerId, updated_at: new Date().toISOString() })
          .eq("id", req.userId!);
      }

      let orgId: string | undefined;
      if (tierRaw === "team") {
        orgId = randomUUID();
        await ensureOrganization(db, orgId, `Team ${req.userEmail ?? req.userId!.slice(0, 8)}`);
        await addOrgMember(db, orgId, req.userId!, "owner");
      }

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: config.checkoutSuccessUrl,
        cancel_url: config.checkoutCancelUrl,
        client_reference_id: req.userId!,
        subscription_data: {
          metadata: {
            supabase_user_id: req.userId!,
            tier: tierRaw,
            ...(orgId ? { org_id: orgId } : {}),
          },
        },
        metadata: {
          supabase_user_id: req.userId!,
          tier: tierRaw,
          ...(orgId ? { org_id: orgId } : {}),
        },
      });

      res.json({ url: session.url, sessionId: session.id });
    } catch (err) {
      const correlationId = newCorrelationId();
      logServerError("POST /api/billing/checkout", err, correlationId);
      sendInternalError(res, correlationId);
    }
  });

  /** Stripe Customer Portal (manage subscription / payment method). */
  router.post("/api/billing/portal", requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const { data: profile } = await db
        .from("profiles")
        .select("stripe_customer_id")
        .eq("id", req.userId!)
        .maybeSingle();
      if (!profile?.stripe_customer_id) {
        res.status(400).json({ error: "no billing account" });
        return;
      }
      const returnUrl =
        typeof req.body?.returnUrl === "string" && req.body.returnUrl.trim()
          ? req.body.returnUrl.trim()
          : config.checkoutCancelUrl;
      if (!isAllowedPortalReturnUrl(returnUrl, config)) {
        res.status(400).json({ error: "returnUrl not allowed" });
        return;
      }
      const portal = await stripe.billingPortal.sessions.create({
        customer: profile.stripe_customer_id,
        return_url: returnUrl,
      });
      res.json({ url: portal.url });
    } catch (err) {
      const correlationId = newCorrelationId();
      logServerError("POST /api/billing/portal", err, correlationId);
      sendInternalError(res, correlationId);
    }
  });

  router.use(createTeamOrgRoutes({ db, requireAuth }));
  router.use(createProRoutes({ config, db }));
  router.use(createTeamRoutes({ config, db }));
  router.use(createTeamBusRoutes({ config, db }));

  return router;
}

/** Webhook router — mount with express.raw() for signature verification. */
export function createStripeWebhookHandler(deps: RouteDeps) {
  const { config, db, stripe } = deps;

  return async (req: Request, res: Response) => {
    const sig = req.headers["stripe-signature"];
    if (!sig || typeof sig !== "string") {
      res.status(400).send("missing stripe-signature");
      return;
    }
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body as Buffer,
        sig,
        config.stripeWebhookSecret
      );
    } catch (err) {
      res.status(400).send(`Webhook Error: ${(err as Error).message}`);
      return;
    }

    try {
      if (await isStripeEventProcessed(db, event.id)) {
        res.json({ received: true, duplicate: true });
        return;
      }

      switch (event.type) {
        case "checkout.session.completed":
          await handleCheckoutCompleted(db, config, event.data.object as Stripe.Checkout.Session, stripe);
          break;
        case "customer.subscription.created":
        case "customer.subscription.updated":
          await handleSubscriptionEvent(
            db,
            config,
            event.data.object as Stripe.Subscription,
            stripe
          );
          break;
        case "customer.subscription.deleted": {
          const sub = event.data.object as Stripe.Subscription;
          const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? "";
          await db
            .from("subscriptions")
            .update({ status: "canceled", updated_at: new Date().toISOString() })
            .eq("stripe_subscription_id", sub.id);
          if (customerId) {
            const { data: profile } = await db
              .from("profiles")
              .select("id")
              .eq("stripe_customer_id", customerId)
              .maybeSingle();
            if (profile?.id) {
              await db
                .from("licenses")
                .update({ revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
                .eq("user_id", profile.id)
                .is("revoked_at", null);
            }
          }
          break;
        }
        default:
          break;
      }

      await recordStripeEvent(db, event.id, event.type);
      res.json({ received: true });
    } catch (err) {
      const correlationId = newCorrelationId();
      logServerError("POST /api/stripe/webhook", err, correlationId);
      sendInternalError(res, correlationId);
    }
  };
}
