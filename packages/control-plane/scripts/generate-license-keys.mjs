#!/usr/bin/env node
/**
 * Generate an Ed25519 keypair for license signing.
 * Private key → CONTROL_PLANE_LICENSE_PRIVATE_KEY_PEM in .env (control plane only).
 * Public key  → paste into packages/core/src/entitlements.ts (VIREON_LICENSE_PUBLIC_KEY_PEM).
 */
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entitlementsPath = path.join(pkgRoot, "../core/src/entitlements.ts");

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });
const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" });

console.log("=== CONTROL_PLANE_LICENSE_PRIVATE_KEY_PEM (server .env only) ===\n");
console.log(privateKeyPem.toString());
console.log("\n=== Public key (SPKI PEM) — update VIREON_LICENSE_PUBLIC_KEY_PEM in entitlements.ts ===\n");
console.log(publicKeyPem.toString());

try {
  const src = readFileSync(entitlementsPath, "utf8");
  const embedded = src.includes(publicKeyPem.toString().trim());
  console.log(
    embedded
      ? "\n✓ Public key already matches packages/core/src/entitlements.ts"
      : "\n⚠ Public key does NOT match entitlements.ts — update VIREON_LICENSE_PUBLIC_KEY_PEM before shipping"
  );
} catch {
  console.log("\n(could not read entitlements.ts for comparison)");
}
