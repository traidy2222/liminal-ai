#!/usr/bin/env node
/**
 * Install EE from production bundle using a license token (E2E helper).
 * Usage: node scripts/e2e-install-ee-from-token.mjs <license-token>
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const token = process.argv[2]?.trim();
const expectTier = process.argv[3]?.trim() || "pro";
if (!token) {
  console.error("Usage: node scripts/e2e-install-ee-from-token.mjs <license-token> [pro|team|enterprise]");
  process.exit(1);
}

const coreDist = path.join(__dirname, "../packages/core/dist/enterprise_install.js");
const loaderDist = path.join(__dirname, "../packages/core/dist/enterprise_loader.js");

let installMod;
let loaderMod;
try {
  installMod = await import(pathToFileURL(coreDist).href);
  loaderMod = await import(pathToFileURL(loaderDist).href);
} catch (err) {
  console.error("Build core first: npm run build -w packages/core");
  if (process.env.E2E_DEBUG) console.error(err);
  process.exit(1);
}

const install = await installMod.ensureEnterpriseEditionInstalled({ token, force: true });
if (!install.installed) {
  console.error("install failed:", install.reason ?? "unknown");
  process.exit(1);
}

const loaded = await loaderMod.loadEnterpriseModule();
if (!loaded.ok) {
  console.error("load failed:", loaded.reason);
  process.exit(1);
}

const entPath = path.join(__dirname, "../packages/core/dist/entitlements.js");
let entMod;
try {
  entMod = await import(pathToFileURL(entPath).href);
} catch {
  console.error("Build core first: npm run build -w packages/core");
  process.exit(1);
}

const resolved = entMod.resolveEntitlements({ token });
if (resolved.tier !== expectTier) {
  console.error(`tier mismatch: expected ${expectTier}, got ${resolved.tier}`);
  process.exit(1);
}
if (expectTier === "team" && !entMod.hasEntitlement(resolved, entMod.ENTITLEMENTS.TEAM_SHARED_MEMORY)) {
  console.error("team license missing team.shared_memory entitlement");
  process.exit(1);
}
if (expectTier === "pro" && !entMod.hasEntitlement(resolved, entMod.ENTITLEMENTS.PRO_CLOUD_SYNC)) {
  console.error("pro license missing pro.cloud_sync entitlement");
  process.exit(1);
}

console.log(
  `installed=${install.path ?? loaded.source} version=${install.version ?? "?"} tier=${resolved.tier}`
);
