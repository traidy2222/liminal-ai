import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  entitlementsForTier,
  type LicenseTier,
  type ResolvedEntitlements,
} from "@liminal/core";
import {
  ENTERPRISE_FEATURES,
  registerEnterpriseFeatures,
  selectEntitledFeatures,
  type EnterpriseFeatureSpec,
} from "./index.js";

function resolved(tier: LicenseTier): ResolvedEntitlements {
  return {
    tier,
    status: tier === "community" ? "community" : "active",
    entitlements: new Set<string>(entitlementsForTier(tier)),
    license: null,
    reason: "test",
  };
}

describe("enterprise feature gating", () => {
  it("registers nothing for community and never calls onFeature", () => {
    const seen: string[] = [];
    const res = registerEnterpriseFeatures({
      entitlements: resolved("community"),
      onFeature: (f) => seen.push(f.id),
    });
    assert.deepEqual(res.registered, []);
    assert.equal(res.skipped.length, ENTERPRISE_FEATURES.length);
    assert.deepEqual(seen, []);
  });

  it("pro unlocks pro features but not team/enterprise", () => {
    const res = registerEnterpriseFeatures({ entitlements: resolved("pro") });
    assert.ok(res.registered.includes("cloud_sync"));
    assert.ok(res.registered.includes("session_history"));
    assert.ok(!res.registered.includes("team_shared_memory"));
    assert.ok(!res.registered.includes("sso"));
  });

  it("team unlocks all pro + team features but not enterprise", () => {
    const res = registerEnterpriseFeatures({ entitlements: resolved("team") });
    assert.ok(res.registered.includes("cloud_sync")); // inherited from pro
    assert.ok(res.registered.includes("team_shared_memory"));
    assert.ok(res.registered.includes("audit_log"));
    assert.ok(!res.registered.includes("sso"));
    assert.ok(!res.registered.includes("self_host"));
  });

  it("enterprise unlocks every feature", () => {
    const res = registerEnterpriseFeatures({ entitlements: resolved("enterprise") });
    assert.equal(res.registered.length, ENTERPRISE_FEATURES.length);
    assert.equal(res.skipped.length, 0);
  });

  it("onFeature is called once per entitled feature", () => {
    const seen: EnterpriseFeatureSpec[] = [];
    registerEnterpriseFeatures({
      entitlements: resolved("team"),
      onFeature: (f) => seen.push(f),
    });
    const entitled = selectEntitledFeatures(resolved("team"));
    assert.equal(seen.length, entitled.length);
  });

  it("every feature maps to a known tier", () => {
    for (const f of ENTERPRISE_FEATURES) {
      assert.ok(["pro", "team", "enterprise"].includes(f.tier), `${f.id} has valid tier`);
    }
  });
});
