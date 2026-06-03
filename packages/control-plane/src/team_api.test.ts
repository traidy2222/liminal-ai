/**
 * HTTP-level team API tests with mock Supabase (no live DB).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";
import { buildLicensePayload, mintLicenseToken } from "./license_service.js";
import { createTeamRoutes } from "./team_routes.js";
import { createTeamOrgRoutes } from "./team_org_routes.js";
import { testConfig, testKeypair } from "./test/license_test_keys.js";
import type { SupabaseClient } from "@supabase/supabase-js";

const ORG = "org_aaa";
const WS = "git:test/repo";
const USER = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

function teamLicenseToken(orgId: string) {
  const keys = testKeypair();
  const config = testConfig(keys);
  const payload = buildLicensePayload(
    { userId: USER, tier: "team", orgId, licenseSub: "lic_sub_team" },
    config
  );
  return { token: mintLicenseToken(payload, config.licensePrivateKeyPem), config };
}

/** Minimal mock: org membership + license user resolution only. */
function mockDbForTeamRoutes(opts: {
  memberRole?: string | null;
  licenseUserId?: string;
}): SupabaseClient {
  const memberRole = opts.memberRole ?? "owner";
  const licenseUserId = opts.licenseUserId ?? USER;
  return {
    from(table: string) {
      if (table === "licenses") {
        return {
          select() {
            return {
              eq(_c: string, _sub: string) {
                return {
                  is() {
                    return {
                      async maybeSingle() {
                        return { data: { user_id: licenseUserId }, error: null };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }
      if (table === "org_members") {
        const chain = {
          _orgId: "",
          _userId: "",
          select(cols?: string, opts?: { count?: string; head?: boolean }) {
            if (opts?.head) {
              return {
                eq(col: string, val: string) {
                  if (col === "org_id") chain._orgId = val;
                  return {
                    async then(onDone: (r: { count: number }) => void) {
                      onDone({ count: 1 });
                    },
                  };
                },
              };
            }
            return chain;
          },
          eq(col: string, val: string) {
            if (col === "org_id") chain._orgId = val;
            if (col === "user_id") chain._userId = val;
            return chain;
          },
          async maybeSingle() {
            if (!memberRole) return { data: null, error: null };
            return { data: { role: memberRole }, error: null };
          },
          upsert() {
            return Promise.resolve({ error: null });
          },
        };
        return chain;
      }
      if (table === "org_memory_notes") {
        return {
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return Promise.resolve({ data: [], error: null });
                  },
                };
              },
            };
          },
          upsert() {
            return Promise.resolve({ error: null });
          },
          update() {
            return { eq: () => Promise.resolve({ error: null }) };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient;
}

function mockDbForInvites(state: {
  invites: Array<{
    token: string;
    org_id: string;
    email: string;
    role: string;
    accepted_by?: string | null;
    expires_at: string;
  }>;
  memberCount: number;
  seats: number;
}) {
  return {
    from(table: string) {
      if (table === "org_invites") {
        return {
          select() {
            return {
              eq(_c: string, token: string) {
                return {
                  async maybeSingle() {
                    const row = state.invites.find((i) => i.token === token);
                    return { data: row ?? null, error: null };
                  },
                };
              },
            };
          },
          insert() {
            return Promise.resolve({ error: null });
          },
          update() {
            return {
              eq(_c: string, token: string) {
                const inv = state.invites.find((i) => i.token === token);
                if (inv) inv.accepted_by = OTHER;
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      }
      if (table === "org_members") {
        return {
          select(_c?: string, opts?: { count?: string; head?: boolean }) {
            if (opts?.head) {
              return {
                eq() {
                  return {
                    async then(onDone: (r: { count: number }) => void) {
                      onDone({ count: state.memberCount });
                    },
                  };
                },
              };
            }
            return {
              eq() {
                return {
                  eq() {
                    return { async maybeSingle() { return { data: null, error: null }; } };
                  },
                };
              },
            };
          },
          upsert() {
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table === "subscriptions") {
        return {
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return {
                      async maybeSingle() {
                        return { data: { seats: state.seats }, error: null };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient;
}

async function listen(app: express.Express, fn: (base: string) => Promise<void>) {
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = (server.address() as { port: number }).port;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

describe("team API (mock db)", () => {
  it("GET notes returns 403 when license org does not match query org", async () => {
    const { token, config } = teamLicenseToken(ORG);
    const db = mockDbForTeamRoutes({ memberRole: "owner" });
    const app = express();
    app.use(express.json());
    app.use(createTeamRoutes({ config, db }));
    await listen(app, async (base) => {
      const res = await fetch(
        `${base}/api/team/memory/notes?org_id=org_other&workspace_fingerprint=${encodeURIComponent(WS)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      assert.equal(res.status, 403);
    });
  });

  it("PUT notes returns 400 for chat-scoped payload", async () => {
    const { token, config } = teamLicenseToken(ORG);
    const db = mockDbForTeamRoutes({ memberRole: "member" });
    const app = express();
    app.use(express.json());
    app.use(createTeamRoutes({ config, db }));
    await listen(app, async (base) => {
      const res = await fetch(`${base}/api/team/memory/notes`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId: ORG,
          workspaceFingerprint: WS,
          revision: 1,
          notes: {
            "fact:x": { value: "y", scope: "chat", updatedAt: "2026-01-01T00:00:00Z" },
          },
        }),
      });
      assert.equal(res.status, 400);
    });
  });

  it("PUT notes returns 200 for workspace-scoped payload", async () => {
    const { token, config } = teamLicenseToken(ORG);
    const db = mockDbForTeamRoutes({ memberRole: "member" });
    const app = express();
    app.use(express.json());
    app.use(createTeamRoutes({ config, db }));
    await listen(app, async (base) => {
      const res = await fetch(`${base}/api/team/memory/notes`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId: ORG,
          workspaceFingerprint: WS,
          revision: 1,
          notes: {
            "fact:port": { value: "3001", scope: "workspace", updatedAt: "2026-01-01T00:00:00Z" },
          },
        }),
      });
      assert.equal(res.status, 200);
    });
  });

  it("invite accept returns 409 when seat limit reached", async () => {
    const db = mockDbForInvites({
      invites: [
        {
          token: "tok1",
          org_id: ORG,
          email: "new@example.com",
          role: "member",
          expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        },
      ],
      memberCount: 1,
      seats: 1,
    });
    const app = express();
    app.use(express.json());
    app.use(
      createTeamOrgRoutes({
        db,
        requireAuth: (req, _res, next) => {
          (req as { userId?: string; userEmail?: string }).userId = OTHER;
          (req as { userEmail?: string }).userEmail = "new@example.com";
          next();
        },
      })
    );
    await listen(app, async (base) => {
      const res = await fetch(`${base}/api/team/invites/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "tok1" }),
      });
      assert.equal(res.status, 409);
    });
  });

  it("invite accept returns 410 when expired", async () => {
    const db = mockDbForInvites({
      invites: [
        {
          token: "tok_exp",
          org_id: ORG,
          email: "new@example.com",
          role: "member",
          expires_at: new Date(Date.now() - 1000).toISOString(),
        },
      ],
      memberCount: 0,
      seats: 5,
    });
    const app = express();
    app.use(express.json());
    app.use(
      createTeamOrgRoutes({
        db,
        requireAuth: (req, _res, next) => {
          (req as { userId?: string; userEmail?: string }).userId = OTHER;
          (req as { userEmail?: string }).userEmail = "new@example.com";
          next();
        },
      })
    );
    await listen(app, async (base) => {
      const res = await fetch(`${base}/api/team/invites/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "tok_exp" }),
      });
      assert.equal(res.status, 410);
    });
  });
});
