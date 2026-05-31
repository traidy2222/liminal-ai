import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import {
  buildLicensePayload,
  mintLicenseToken,
  licenseVerifyResponse,
  subscriptionGrantsLicense,
} from "./license_service.js";
import type { ControlPlaneConfig } from "./config.js";

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

const baseConfig: ControlPlaneConfig = {
  port: 3002,
  licensePrivateKeyPem: "",
  licensePublicKeyPem: "",
  licenseTermDays: 30,
  supabaseUrl: "https://example.supabase.co",
  supabaseServiceRoleKey: "svc",
  supabaseAnonKey: "anon",
  stripeSecretKey: "sk_test",
  stripeWebhookSecret: "whsec",
  stripePricePro: "price_pro",
  stripePriceTeam: "price_team",
  stripePriceEnterprise: "price_ent",
  checkoutSuccessUrl: "http://localhost/success",
  checkoutCancelUrl: "http://localhost/cancel",
};

describe("license_service", () => {
  it("mints a verifiable pro token", () => {
    const keys = keypair();
    const config = { ...baseConfig, licensePrivateKeyPem: keys.privateKeyPem, licensePublicKeyPem: keys.publicKeyPem };
    const payload = buildLicensePayload({ userId: "u1", tier: "pro" }, config);
    const token = mintLicenseToken(payload, config.licensePrivateKeyPem);
    const out = licenseVerifyResponse(token, config.licensePublicKeyPem);
    assert.equal(out.ok, true);
    assert.equal(out.tier, "pro");
    assert.equal(out.status, "active");
    assert.ok(out.entitlements.includes("pro.cloud_sync"));
  });

  it("subscriptionGrantsLicense gates issuance", () => {
    assert.equal(subscriptionGrantsLicense("active"), true);
    assert.equal(subscriptionGrantsLicense("trialing"), true);
    assert.equal(subscriptionGrantsLicense("canceled"), false);
  });
});
