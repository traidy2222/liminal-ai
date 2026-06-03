import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { OrgAuthError, roleAtLeast, requireOrgRole } from "./org_auth.js";
import type { SupabaseClient } from "@supabase/supabase-js";

function mockDb(role: string | null): SupabaseClient {
  return {
    from(table: string) {
      if (table !== "org_members") throw new Error(`unexpected table ${table}`);
      return {
        select() {
          return {
            eq(_col: string, _val: string) {
              return {
                eq() {
                  return {
                    async maybeSingle() {
                      return { data: role ? { role } : null, error: null };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
}

describe("org_auth", () => {
  it("roleAtLeast orders owner > admin > member > viewer", () => {
    assert.equal(roleAtLeast("owner", "viewer"), true);
    assert.equal(roleAtLeast("viewer", "member"), false);
    assert.equal(roleAtLeast("admin", "member"), true);
    assert.equal(roleAtLeast("member", "admin"), false);
  });

  it("requireOrgRole throws when not a member", async () => {
    await assert.rejects(
      () => requireOrgRole(mockDb(null), "org1", "u1", "viewer"),
      OrgAuthError
    );
  });

  it("requireOrgRole allows viewer for viewer gate", async () => {
    const role = await requireOrgRole(mockDb("viewer"), "org1", "u1", "viewer");
    assert.equal(role, "viewer");
  });

  it("requireOrgRole rejects viewer for member gate", async () => {
    await assert.rejects(
      () => requireOrgRole(mockDb("viewer"), "org1", "u1", "member"),
      OrgAuthError
    );
  });
});
