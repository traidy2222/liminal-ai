import type { SupabaseClient } from "@supabase/supabase-js";
import { OrgAuthError, getOrgMemberRole, requireOrgRole, type OrgRole } from "./org_auth.js";

export class OrgMemberError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message);
    this.name = "OrgMemberError";
  }
}

const ASSIGNABLE: OrgRole[] = ["admin", "member", "viewer"];

export async function listOrgMembersWithProfiles(db: SupabaseClient, orgId: string) {
  const { data: members, error } = await db
    .from("org_members")
    .select("user_id, role, created_at, accepted_at")
    .eq("org_id", orgId);
  if (error) throw new Error(error.message);
  const rows = members ?? [];
  if (rows.length === 0) return [];
  const userIds = rows.map((m) => m.user_id as string);
  const { data: profiles, error: pErr } = await db
    .from("profiles")
    .select("id, email, display_name")
    .in("id", userIds);
  if (pErr) throw new Error(pErr.message);
  const byId = new Map(
    (profiles ?? []).map((p) => [
      p.id as string,
      { email: (p.email as string | null) ?? null, display_name: (p.display_name as string | null) ?? null },
    ])
  );
  return rows.map((m) => ({
    user_id: m.user_id as string,
    role: m.role as OrgRole,
    created_at: m.created_at as string,
    accepted_at: (m.accepted_at as string | null) ?? null,
    email: byId.get(m.user_id as string)?.email ?? null,
    display_name: byId.get(m.user_id as string)?.display_name ?? null,
  }));
}

async function countOwners(db: SupabaseClient, orgId: string): Promise<number> {
  const { count, error } = await db
    .from("org_members")
    .select("*", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("role", "owner");
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function updateMemberRole(
  db: SupabaseClient,
  orgId: string,
  actorId: string,
  targetUserId: string,
  role: OrgRole
): Promise<void> {
  await requireOrgRole(db, orgId, actorId, "admin");
  if (role === "owner" || !ASSIGNABLE.includes(role)) {
    throw new OrgMemberError("invalid role", "invalid_role");
  }
  const targetRole = await getOrgMemberRole(db, orgId, targetUserId);
  if (!targetRole) throw new OrgMemberError("not found", "not_found");
  if (targetRole === "owner") throw new OrgMemberError("cannot change owner", "cannot_change_owner");
  const { error } = await db
    .from("org_members")
    .update({ role })
    .eq("org_id", orgId)
    .eq("user_id", targetUserId);
  if (error) throw new Error(error.message);
}

export async function removeMember(
  db: SupabaseClient,
  orgId: string,
  actorId: string,
  targetUserId: string
): Promise<void> {
  await requireOrgRole(db, orgId, actorId, "admin");
  const targetRole = await getOrgMemberRole(db, orgId, targetUserId);
  if (!targetRole) throw new OrgMemberError("not found", "not_found");
  if (targetRole === "owner") {
    if ((await countOwners(db, orgId)) <= 1) {
      throw new OrgMemberError("last owner", "last_owner");
    }
    throw new OrgMemberError("target is owner", "target_is_owner");
  }
  const { error } = await db
    .from("org_members")
    .delete()
    .eq("org_id", orgId)
    .eq("user_id", targetUserId);
  if (error) throw new Error(error.message);
}

export async function queryAuditEvents(
  db: SupabaseClient,
  orgId: string,
  actorId: string,
  limit = 50
): Promise<{ events: unknown[] }> {
  await requireOrgRole(db, orgId, actorId, "admin");
  const { data, error } = await db
    .from("org_audit_events")
    .select("id, user_id, session_id, event_type, payload, created_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(Math.min(limit, 200));
  if (error) throw new Error(error.message);
  return { events: data ?? [] };
}

export async function listPendingInvites(db: SupabaseClient, orgId: string, actorId: string) {
  await requireOrgRole(db, orgId, actorId, "admin");
  const { data, error } = await db
    .from("org_invites")
    .select("token, email, role, expires_at, created_at")
    .eq("org_id", orgId)
    .is("accepted_by", null)
    .is("revoked_at", null);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function revokeInvite(
  db: SupabaseClient,
  orgId: string,
  actorId: string,
  token: string
): Promise<void> {
  await requireOrgRole(db, orgId, actorId, "admin");
  const { error } = await db
    .from("org_invites")
    .update({ revoked_at: new Date().toISOString(), revoked_by: actorId })
    .eq("org_id", orgId)
    .eq("token", token)
    .is("accepted_by", null);
  if (error) throw new Error(error.message);
}
