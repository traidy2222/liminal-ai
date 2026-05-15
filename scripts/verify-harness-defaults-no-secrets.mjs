/**
 * Fail if harness_default_constants.ts looks like it contains secrets or API keys.
 * Run from repo root: node scripts/verify-harness-defaults-no-secrets.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const path = join(root, "packages", "core", "src", "harness_default_constants.ts");
const text = readFileSync(path, "utf8");

const banned = [
  /AGENT_API_KEY/i,
  /OPENROUTER_API_KEY/i,
  /OPENAI_API_KEY/i,
  /sk-[a-z0-9]{10,}/i,
  /Bearer\s+[a-z0-9._-]{8,}/i,
  /api[_-]?key\s*:\s*["'][^"']{12,}["']/i,
];

const hits = [];
for (const re of banned) {
  const m = text.match(re);
  if (m) hits.push(m[0].slice(0, 80));
}

if (hits.length > 0) {
  console.error("verify-harness-defaults-no-secrets: forbidden patterns in harness_default_constants.ts:");
  for (const h of hits) console.error("  -", h);
  process.exit(1);
}

console.log("verify-harness-defaults-no-secrets: ok");
