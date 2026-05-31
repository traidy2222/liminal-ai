import { Router, type Request, type Response } from "express";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ControlPlaneConfig, PaidTier } from "./config.js";
import { stripePriceIdForTier } from "./config.js";
import { licenseVerifyResponse } from "./license_service.js";
import { createAuthMiddleware, type AuthedRequest } from "./auth.js";
import {
  ensureProfile,
  getActiveLicenseForUser,
  recordStripeEvent,
} from "./supabase_admin.js";
import { handleCheckoutCompleted, handleSubscriptionEvent } from "./stripe_handlers.js";

const PAID_TIERS = ["pro", "team", "enterprise"] as const;

function isPaidTier(t: string): t is PaidTier {
  return (PAID_TIERS as readonly string[]).includes(t);
}

export interface RouteDeps {
  config: ControlPlaneConfig;
  db: SupabaseClient;
  stripe: Stripe;
}

export function createRoutes(deps: RouteDeps): Router {
  const { config, db, stripe } = deps;
  const router = Router();
  const requireAuth = createAuthMiddleware(config);

  router.get("/health", (_req, res) => {
    res.json({ ok: true, service: "liminal-control-plane" });
  });

  /** Offline-verifiable license check (no auth — harness + dashboard copy-paste). */
  router.post("/api/license/verify", (req, res) => {
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
      res.status(500).json({ error: (err as Error).message });
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

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: config.checkoutSuccessUrl,
        cancel_url: config.checkoutCancelUrl,
        client_reference_id: req.userId!,
        subscription_data: {
          metadata: { supabase_user_id: req.userId!, tier: tierRaw },
        },
        metadata: { supabase_user_id: req.userId!, tier: tierRaw },
      });

      res.json({ url: session.url, sessionId: session.id });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
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
      const portal = await stripe.billingPortal.sessions.create({
        customer: profile.stripe_customer_id,
        return_url: returnUrl,
      });
      res.json({ url: portal.url });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

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
      const idempotency = await recordStripeEvent(db, event.id, event.type);
      if (idempotency === "duplicate") {
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

      res.json({ received: true });
    } catch (err) {
      console.error("[stripe] webhook handler error", err);
      res.status(500).json({ error: (err as Error).message });
    }
  };
}
