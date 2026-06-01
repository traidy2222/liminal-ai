import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ControlPlaneConfig, PaidTier } from "./config.js";
import type { LicensePayload } from "@liminal/core";

export type ProfileRow = {
  id: string;
  email: string | null;
  stripe_customer_id: string | null;
};

export type LicenseRow = {
  id: string;
  license_sub: string;
  user_id: string;
  tier: PaidTier;
  token: string;
  expires_at: string;
  seats: number;
  org_id: string | null;
  revoked_at: string | null;
};

export function createSupabaseAdmin(config: ControlPlaneConfig): SupabaseClient {
  return createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function ensureProfile(
  db: SupabaseClient,
  userId: string,
  email?: string | null
): Promise<void> {
  const { error } = await db.from("profiles").upsert(
    {
      id: userId,
      email: email ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );
  if (error) throw new Error(`profiles upsert: ${error.message}`);
}

export async function setProfileStripeCustomer(
  db: SupabaseClient,
  userId: string,
  stripeCustomerId: string
): Promise<void> {
  const { error } = await db
    .from("profiles")
    .update({ stripe_customer_id: stripeCustomerId, updated_at: new Date().toISOString() })
    .eq("id", userId);
  if (error) throw new Error(`profiles stripe_customer_id: ${error.message}`);
}

export async function upsertSubscription(
  db: SupabaseClient,
  row: {
    userId: string;
    stripeSubscriptionId: string;
    stripeCustomerId: string;
    tier: PaidTier;
    status: string;
    currentPeriodEnd: Date | null;
    seats?: number;
    orgId?: string;
  }
): Promise<void> {
  const { error } = await db.from("subscriptions").upsert(
    {
      user_id: row.userId,
      stripe_subscription_id: row.stripeSubscriptionId,
      stripe_customer_id: row.stripeCustomerId,
      tier: row.tier,
      status: row.status,
      current_period_end: row.currentPeriodEnd?.toISOString() ?? null,
      seats: row.seats ?? 1,
      org_id: row.orgId ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "stripe_subscription_id" }
  );
  if (error) throw new Error(`subscriptions upsert: ${error.message}`);
}

export async function findUserIdByStripeCustomer(
  db: SupabaseClient,
  stripeCustomerId: string
): Promise<string | null> {
  const { data, error } = await db
    .from("profiles")
    .select("id")
    .eq("stripe_customer_id", stripeCustomerId)
    .maybeSingle();
  if (error) throw new Error(`profiles lookup: ${error.message}`);
  return data?.id ?? null;
}

export async function getActiveLicenseForUser(
  db: SupabaseClient,
  userId: string
): Promise<LicenseRow | null> {
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("licenses")
    .select("*")
    .eq("user_id", userId)
    .is("revoked_at", null)
    .gt("expires_at", now)
    .order("expires_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`licenses select: ${error.message}`);
  return (data as LicenseRow | null) ?? null;
}

export async function persistLicense(
  db: SupabaseClient,
  userId: string,
  payload: LicensePayload,
  token: string
): Promise<void> {
  const expiresAt = new Date(payload.exp * 1000).toISOString();
  // Revoke prior active licenses for this user (single active seat token)
  const { error: revokeErr } = await db
    .from("licenses")
    .update({ revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("revoked_at", null);
  if (revokeErr) throw new Error(`licenses revoke: ${revokeErr.message}`);

  const { error } = await db.from("licenses").upsert(
    {
      license_sub: payload.sub,
      user_id: userId,
      tier: payload.tier as PaidTier,
      token,
      expires_at: expiresAt,
      seats: payload.seats ?? 1,
      org_id: payload.org ?? null,
      revoked_at: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "license_sub" }
  );
  if (error) throw new Error(`licenses upsert: ${error.message}`);
}

export async function isStripeEventProcessed(
  db: SupabaseClient,
  stripeEventId: string
): Promise<boolean> {
  const { data, error } = await db
    .from("stripe_webhook_events")
    .select("stripe_event_id")
    .eq("stripe_event_id", stripeEventId)
    .maybeSingle();
  if (error) throw new Error(`stripe_webhook_events select: ${error.message}`);
  return !!data;
}

export async function recordStripeEvent(
  db: SupabaseClient,
  stripeEventId: string,
  eventType: string
): Promise<void> {
  const { error } = await db.from("stripe_webhook_events").insert({
    stripe_event_id: stripeEventId,
    event_type: eventType,
  });
  if (error && error.code !== "23505") {
    throw new Error(`stripe_webhook_events insert: ${error.message}`);
  }
}

async function profileExists(db: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await db.from("profiles").select("id").eq("id", userId).maybeSingle();
  if (error) throw new Error(`profiles lookup: ${error.message}`);
  return !!data?.id;
}

function metadataUserId(metadata: Record<string, string> | null | undefined): string | null {
  return metadata?.supabase_user_id?.trim() || metadata?.user_id?.trim() || null;
}

export async function resolveUserIdFromMetadata(
  db: SupabaseClient,
  metadata: Record<string, string> | null | undefined,
  stripeCustomerId?: string,
  clientReferenceId?: string | null
): Promise<string | null> {
  const metaId = metadataUserId(metadata);
  const refId = clientReferenceId?.trim() || null;

  if (stripeCustomerId) {
    const fromCustomer = await findUserIdByStripeCustomer(db, stripeCustomerId);
    if (fromCustomer) {
      if (metaId && metaId !== fromCustomer) {
        console.warn(
          "[stripe] metadata user_id does not match stripe customer profile; using customer lookup",
          { metaId, fromCustomer }
        );
      }
      return fromCustomer;
    }
  }

  if (refId && (await profileExists(db, refId))) {
    return refId;
  }

  if (metaId && (await profileExists(db, metaId))) {
    return metaId;
  }

  return null;
}
