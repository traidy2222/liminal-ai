import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PaidTier } from "./config.js";
import { addOrgMember, getOrgMemberRole } from "./org_auth.js";

export type OrgStatus = "pending" | "active" | "cancelled";

const TEAM_TIERS: PaidTier[] = ["team", "enterprise"];

export function tierRequiresOrg(tier: PaidTier): boolean {
  return TEAM_TIERS.includes(tier);
}

export class OrgServiceError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message);
    this.name = "OrgServiceError";
  }
}

export async function getOrganization(
  db: SupabaseClient,
  orgId: string
): Promise<{ id: string; name: string; status: OrgStatus } | null> {
  const { data, error } = await db
    .from("organizations")
    .select("id, name, status")
    .eq("id", orgId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as { id: string; name: string; status: OrgStatus } | null;
}

export async function activateOrg(db: SupabaseClient, orgId: string): Promise<void> {
  const { error } = await db
    .from("organizations")
    .update({ status: "active", updated_at: new Date().toISOString() })
    .eq("id", orgId);
  if (error) throw new Error(error.message);
}

export async function assertOrgReadyForCheckout(
  db: SupabaseClient,
  userId: string,
  orgId: string,
  tier: PaidTier
): Promise<void> {
  if (!tierRequiresOrg(tier)) {
    throw new OrgServiceError("orgId only for team or enterprise", "org_required");
  }
  const org = await getOrganization(db, orgId);
  if (!org) throw new OrgServiceError("Organization not found", "not_found");
  if (org.status !== "pending") {
    throw new OrgServiceError("Organization is not awaiting checkout", "not_pending");
  }
  const role = await getOrgMemberRole(db, orgId, userId);
  if (role !== "owner") {
    throw new OrgServiceError("Only the organization owner can complete checkout", "forbidden");
  }
}

export async function provisionTeamOrgAfterPayment(
  db: SupabaseClient,
  userId: string,
  orgId: string
): Promise<void> {
  await activateOrg(db, orgId);
  await addOrgMember(db, orgId, userId, "owner");
}

export function newOrgId(): string {
  return randomUUID();
}
