import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { entitlementsForTier } from "@liminal/core";
import { createTeamRoutes } from "./team_routes.js";

describe("team_routes", () => {
  it("exports router factory", () => {
    const router = createTeamRoutes({
      config: { licensePublicKeyPem: "", licensePrivateKeyPem: "" } as never,
      db: {} as never,
    });
    assert.ok(router);
  });
});

describe("team entitlements", () => {
  it("team tier includes team.shared_memory", () => {
    assert.ok(entitlementsForTier("team").includes("team.shared_memory"));
  });
});
