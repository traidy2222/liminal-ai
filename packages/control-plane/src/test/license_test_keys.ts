import { generateKeyPairSync } from "node:crypto";
import type { ControlPlaneConfig } from "../config.js";

export function testKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

export function testConfig(keys: { publicKeyPem: string; privateKeyPem: string }): ControlPlaneConfig {
  return {
    port: 3002,
    licensePrivateKeyPem: keys.privateKeyPem,
    licensePublicKeyPem: keys.publicKeyPem,
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
    corsOrigins: ["http://localhost"],
  };
}
