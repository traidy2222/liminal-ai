#!/usr/bin/env node
/**
 * Install EE from production bundle using a license token (E2E helper).
 * Usage: node scripts/e2e-install-ee-from-token.mjs <license-token>
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const token = process.argv[2]?.trim();
if (!token) {
  console.error("Usage: node scripts/e2e-install-ee-from-token.mjs <license-token>");
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

console.log(`installed=${install.path ?? loaded.source} version=${install.version ?? "?"}`);
