import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import {
  ENTITLEMENTS,
  COMMUNITY_ENTITLEMENTS,
  LICENSE_TIERS,
  entitlementsForTier,
  parseLicenseToken,
  verifyLicenseToken,
  signLicenseToken,
  resolveEntitlements,
  hasEntitlement,
  gateFamiliesByEntitlements,
  isFamilyEntitled,
  type LicensePayload,
} from "./entitlements.js";

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

const NOW = 1_900_000_000_000; // fixed clock (ms)
const SEC = Math.floor(NOW / 1000);

function makePayload(over: Partial<LicensePayload> = {}): LicensePayload {
  return {
    v: 1,
    sub: "lic_123",
    tier: "team",
    iat: SEC - 1000,
    exp: SEC + 30 * 86_400, // 30 days out
    iss: "vireon",
    ...over,
  };
}

describe("tier → entitlement mapping", () => {
  it("community grants nothing", () => {
    assert.deepEqual(entitlementsForTier("community"), []);
    assert.deepEqual([...COMMUNITY_ENTITLEMENTS], []);
  });

  it("higher tiers inherit lower-tier entitlements", () => {
    const pro = entitlementsForTier("pro");
    const team = entitlementsForTier("team");
    const ent = entitlementsForTier("enterprise");
    assert.ok(pro.includes(ENTITLEMENTS.PRO_CLOUD_SYNC));
    for (const e of pro) assert.ok(team.includes(e), `team should inherit ${e}`);
    assert.ok(team.includes(ENTITLEMENTS.TEAM_SHARED_MEMORY));
    for (const e of team) assert.ok(ent.includes(e), `enterprise should inherit ${e}`);
    assert.ok(ent.includes(ENTITLEMENTS.ENT_SSO));
  });

  it("covers every declared tier", () => {
    for (const t of LICENSE_TIERS) assert.ok(Array.isArray(entitlementsForTier(t)));
  });
});

describe("sign / verify round-trip", () => {
  it("verifies a token signed with the matching key", () => {
    const { publicKeyPem, privateKeyPem } = keypair();
    const token = signLicenseToken(makePayload(), privateKeyPem);
    const res = verifyLicenseToken(token, publicKeyPem);
    assert.equal(res.ok, true);
    assert.equal(res.payload?.tier, "team");
  });

  it("rejects a token signed with a different key (no minting in harness)", () => {
    const a = keypair();
    const b = keypair();
    const token = signLicenseToken(makePayload(), a.privateKeyPem);
    assert.equal(verifyLicenseToken(token, b.publicKeyPem).ok, false);
  });

  it("rejects a tampered payload", () => {
    const { publicKeyPem, privateKeyPem } = keypair();
    const token = signLicenseToken(makePayload({ tier: "pro" }), privateKeyPem);
    const [head, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify(makePayload({ tier: "enterprise" })), "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    assert.equal(verifyLicenseToken(`${forged}.${sig}`, publicKeyPem).ok, false);
    // sanity: untampered head still verifies
    assert.equal(verifyLicenseToken(`${head}.${sig}`, publicKeyPem).ok, true);
  });

  it("returns parse failure for malformed tokens", () => {
    assert.equal(parseLicenseToken("not-a-token"), null);
    assert.equal(verifyLicenseToken("a.b.c", "key").ok, false);
  });

  it("returns false when no public key is configured", () => {
    const { privateKeyPem } = keypair();
    const token = signLicenseToken(makePayload(), privateKeyPem);
    assert.equal(verifyLicenseToken(token, "").ok, false);
  });
});

describe("resolveEntitlements", () => {
  it("returns community when no token present", () => {
    const r = resolveEntitlements({ token: "", now: NOW });
    assert.equal(r.tier, "community");
    assert.equal(r.status, "community");
    assert.equal(r.entitlements.size, 0);
  });

  it("activates a valid unexpired license", () => {
    const { publicKeyPem, privateKeyPem } = keypair();
    const token = signLicenseToken(makePayload({ tier: "pro" }), privateKeyPem);
    const r = resolveEntitlements({ token, publicKeyPem, now: NOW });
    assert.equal(r.status, "active");
    assert.equal(r.tier, "pro");
    assert.equal(hasEntitlement(r, ENTITLEMENTS.PRO_CLOUD_SYNC), true);
    assert.equal(hasEntitlement(r, ENTITLEMENTS.TEAM_SHARED_MEMORY), false);
  });

  it("honors explicit extra entitlements beyond the tier", () => {
    const { publicKeyPem, privateKeyPem } = keypair();
    const token = signLicenseToken(
      makePayload({ tier: "pro", ent: [ENTITLEMENTS.TEAM_AUDIT_LOG] }),
      privateKeyPem
    );
    const r = resolveEntitlements({ token, publicKeyPem, now: NOW });
    assert.equal(hasEntitlement(r, ENTITLEMENTS.TEAM_AUDIT_LOG), true);
  });

  it("keeps a recently-expired license alive within the grace window", () => {
    const { publicKeyPem, privateKeyPem } = keypair();
    const expSec = SEC - 2 * 86_400; // expired 2 days ago
    const token = signLicenseToken(makePayload({ tier: "team", exp: expSec }), privateKeyPem);
    const r = resolveEntitlements({ token, publicKeyPem, now: NOW });
    assert.equal(r.status, "grace");
    assert.equal(hasEntitlement(r, ENTITLEMENTS.TEAM_SHARED_MEMORY), true);
  });

  it("downgrades to community past the grace window", () => {
    const { publicKeyPem, privateKeyPem } = keypair();
    const expSec = SEC - 60 * 86_400; // expired 60 days ago (> 14d default grace)
    const token = signLicenseToken(makePayload({ tier: "team", exp: expSec }), privateKeyPem);
    const r = resolveEntitlements({ token, publicKeyPem, now: NOW });
    assert.equal(r.status, "expired");
    assert.equal(r.tier, "community");
    assert.equal(r.entitlements.size, 0);
  });

  it("downgrades to community on an invalid signature", () => {
    const a = keypair();
    const b = keypair();
    const token = signLicenseToken(makePayload(), a.privateKeyPem);
    const r = resolveEntitlements({ token, publicKeyPem: b.publicKeyPem, now: NOW });
    assert.equal(r.status, "invalid");
    assert.equal(r.tier, "community");
  });
});

describe("family gating hook", () => {
  it("passes through all families when nothing is gated (CE default)", () => {
    const r = resolveEntitlements({ token: "", now: NOW });
    const families = ["memory_advanced", "vault", "web"];
    assert.deepEqual(gateFamiliesByEntitlements(families, r), families);
    assert.equal(isFamilyEntitled("memory_advanced", r), true);
  });
});
