import type { SupabaseClient } from "@supabase/supabase-js";

export type OrgRole = "owner" | "admin" | "member" | "viewer";

const ROLE_RANK: Record<OrgRole, number> = {
  viewer: 1,
  member: 2,
  admin: 3,
  owner: 4,
};

export async function getOrgMemberRole(
  db: SupabaseClient,
  orgId: string,
  userId: string
): Promise<OrgRole | null> {
  const { data, error } = await db
    .from("org_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`org_members lookup: ${error.message}`);
  const role = data?.role as OrgRole | undefined;
  return role ?? null;
}

export function roleAtLeast(role: OrgRole, min: OrgRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

export async function requireOrgRole(
  db: SupabaseClient,
  orgId: string,
  userId: string,
  minRole: OrgRole
): Promise<OrgRole> {
  const role = await getOrgMemberRole(db, orgId, userId);
  if (!role || !roleAtLeast(role, minRole)) {
    throw new OrgAuthError("forbidden");
  }
  return role;
}

export class OrgAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrgAuthError";
  }
}

export async function ensureOrganization(
  db: SupabaseClient,
  orgId: string,
  name?: string
): Promise<void> {
  const { error } = await db.from("organizations").upsert(
    {
      id: orgId,
      name: name ?? `Org ${orgId.slice(0, 8)}`,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );
  if (error) throw new Error(`organizations upsert: ${error.message}`);
}

export async function addOrgMember(
  db: SupabaseClient,
  orgId: string,
  userId: string,
  role: OrgRole
): Promise<void> {
  const { error } = await db.from("org_members").upsert(
    {
      org_id: orgId,
      user_id: userId,
      role,
      accepted_at: new Date().toISOString(),
    },
    { onConflict: "org_id,user_id" }
  );
  if (error) throw new Error(`org_members upsert: ${error.message}`);
}
