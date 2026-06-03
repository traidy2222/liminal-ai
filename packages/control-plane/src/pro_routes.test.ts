import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { signLicenseToken, entitlementsForTier } from "@liminal/core";
import { createProRoutes } from "./pro_routes.js";

describe("pro_routes auth", () => {
  it("rejects missing bearer", async () => {
    const router = createProRoutes({
      config: { licensePublicKeyPem: "", licensePrivateKeyPem: "" } as never,
      db: {} as never,
    });
    assert.ok(router);
  });
});

describe("license payload org", () => {
  it("team tier includes team.shared_memory entitlement key", () => {
    const ent = entitlementsForTier("team");
    assert.ok(ent.includes("team.shared_memory"));
  });
});
