import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ControlPlaneConfig, PaidTier } from "./config.js";
import { tierForStripePriceId } from "./config.js";
import {
  buildLicensePayload,
  mintLicenseToken,
  subscriptionGrantsLicense,
  epochSecFromDate,
} from "./license_service.js";
import {
  ensureProfile,
  persistLicense,
  setProfileStripeCustomer,
  upsertSubscription,
  resolveUserIdFromMetadata,
} from "./supabase_admin.js";
import { provisionTeamOrgAfterPayment, tierRequiresOrg } from "./org_service.js";

function tierFromSubscription(
  sub: Stripe.Subscription,
  config: ControlPlaneConfig
): PaidTier | null {
  const item = sub.items.data[0];
  const priceId = item?.price?.id ?? "";
  return tierForStripePriceId(config, priceId);
}

function periodEnd(sub: Stripe.Subscription): Date | null {
  const end = sub.current_period_end;
  if (typeof end === "number") return new Date(end * 1000);
  return null;
}

export async function issueLicenseForSubscription(
  db: SupabaseClient,
  config: ControlPlaneConfig,
  userId: string,
  tier: PaidTier,
  sub: Stripe.Subscription
): Promise<string> {
  await ensureProfile(db, userId);
  const fallbackExp = Math.floor(Date.now() / 1000) + config.licenseTermDays * 86_400;
  const expSec = epochSecFromDate(periodEnd(sub), fallbackExp);
  const orgId = (sub.metadata?.org_id as string | undefined)?.trim() || undefined;
  if (tierRequiresOrg(tier)) {
    if (!orgId) {
      throw new Error(`Team/Enterprise license requires org_id on subscription ${sub.id}`);
    }
    await provisionTeamOrgAfterPayment(db, userId, orgId);
  }

  const payload = buildLicensePayload(
    {
      userId,
      tier,
      expSec,
      seats: sub.items.data[0]?.quantity ?? 1,
      orgId,
    },
    config
  );
  const token = mintLicenseToken(payload, config.licensePrivateKeyPem);
  await persistLicense(db, userId, payload, token);
  return token;
}

export async function handleSubscriptionEvent(
  db: SupabaseClient,
  config: ControlPlaneConfig,
  sub: Stripe.Subscription,
  stripe: Stripe
): Promise<void> {
  const tier = tierFromSubscription(sub, config);
  if (!tier) {
    console.warn("[stripe] subscription missing mapped price id", sub.id);
    return;
  }

  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? "";
  let userId = await resolveUserIdFromMetadata(db, sub.metadata as Record<string, string>, customerId);

  if (!userId && customerId) {
    const customer = await stripe.customers.retrieve(customerId);
    if (!customer.deleted) {
      userId = await resolveUserIdFromMetadata(
        db,
        customer.metadata as Record<string, string>,
        customerId
      );
    }
  }

  if (!userId) {
    console.warn("[stripe] no supabase user for subscription", sub.id);
    return;
  }

  if (customerId) await setProfileStripeCustomer(db, userId, customerId);

  await upsertSubscription(db, {
    userId,
    stripeSubscriptionId: sub.id,
    stripeCustomerId: customerId,
    tier,
    status: sub.status,
    currentPeriodEnd: periodEnd(sub),
    seats: sub.items.data[0]?.quantity ?? 1,
    orgId: sub.metadata?.org_id,
  });

  if (subscriptionGrantsLicense(sub.status)) {
    await issueLicenseForSubscription(db, config, userId, tier, sub);
  }
}

export async function handleCheckoutCompleted(
  db: SupabaseClient,
  config: ControlPlaneConfig,
  session: Stripe.Checkout.Session,
  stripe: Stripe
): Promise<void> {
  const userId = await resolveUserIdFromMetadata(
    db,
    session.metadata as Record<string, string>,
    typeof session.customer === "string" ? session.customer : session.customer?.id,
    session.client_reference_id
  );
  if (!userId) {
    console.warn("[stripe] checkout.session.completed without user", session.id);
    return;
  }

  const customerId =
    typeof session.customer === "string" ? session.customer : session.customer?.id ?? "";
  if (customerId) await setProfileStripeCustomer(db, userId, customerId);

  const subId =
    typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
  if (subId) {
    const sub = await stripe.subscriptions.retrieve(subId);
    await handleSubscriptionEvent(db, config, sub, stripe);
  }
}
