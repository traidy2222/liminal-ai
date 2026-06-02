#!/usr/bin/env node
/**
 * Pack proprietary @liminal/enterprise for control-plane distribution.
 * Run after: npm run build -w packages/enterprise
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const eeRoot = path.join(root, "packages", "enterprise");
const outDir = path.join(root, ".enterprise-bundle");
const archive = path.join(root, "enterprise-bundle.tar.gz");
const sidecar = path.join(root, "enterprise-bundle.manifest.json");

if (!existsSync(path.join(eeRoot, "dist", "index.js"))) {
  console.error("Build enterprise first: npm run build -w packages/enterprise");
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(path.join(eeRoot, "package.json"), "utf8"));
const version = pkg.version ?? "0.0.0";
const builtAt = new Date().toISOString();

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
cpSync(path.join(eeRoot, "dist"), path.join(outDir, "dist"), { recursive: true });
cpSync(path.join(eeRoot, "package.json"), path.join(outDir, "package.json"));
cpSync(path.join(eeRoot, "LICENSE-EE"), path.join(outDir, "LICENSE-EE"));

const manifest = { version, builtAt, sha256: "" };
writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));

const tar = spawnSync("tar", ["-czf", archive, "-C", outDir, "."], { encoding: "utf8" });
if (tar.status !== 0) {
  console.error(tar.stderr?.trim() || "tar failed");
  process.exit(tar.status ?? 1);
}

manifest.sha256 = createHash("sha256").update(readFileSync(archive)).digest("hex");
writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
writeFileSync(sidecar, JSON.stringify(manifest, null, 2));

spawnSync("tar", ["-czf", archive, "-C", outDir, "."], { stdio: "inherit" });

console.log(`\nWrote ${archive}`);
console.log(`Wrote ${sidecar}`);
console.log(`version=${version} sha256=${manifest.sha256}`);
