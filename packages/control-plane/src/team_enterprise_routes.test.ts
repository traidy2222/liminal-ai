import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { entitlementsForTier } from "@liminal/core";
import { createTeamEnterpriseRoutes } from "./team_enterprise_routes.js";

describe("team_enterprise_routes", () => {
  it("exports router factory", () => {
    const router = createTeamEnterpriseRoutes({
      config: { licensePublicKeyPem: "" } as never,
      db: {} as never,
    });
    assert.ok(router);
  });
});

describe("team enterprise entitlements", () => {
  it("team tier includes audit, fleet, policy, rbac", () => {
    const ent = entitlementsForTier("team");
    assert.ok(ent.includes("team.audit_log"));
    assert.ok(ent.includes("team.fleet_config"));
    assert.ok(ent.includes("team.policy_governance"));
    assert.ok(ent.includes("team.rbac"));
  });

  it("enterprise tier includes sso and self_host", () => {
    const ent = entitlementsForTier("enterprise");
    assert.ok(ent.includes("enterprise.sso"));
    assert.ok(ent.includes("enterprise.self_host"));
  });
});
