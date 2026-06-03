/**
 * Fail if tracked files look like they contain secrets (API keys, PEM private keys, JWT service role).
 * Run from repo root: npm run verify:repo-secrets
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function listTrackedFiles() {
  const out = execSync("git ls-files -z", { cwd: root, encoding: "buffer" });
  return out
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .filter((f) => !f.startsWith("packages/enterprise/"));
}

const allowPaths = new Set([
  "packages/core/src/entitlements.ts",
  "scripts/verify-repo-secrets.mjs",
  "scripts/verify-harness-defaults-no-secrets.mjs",
  "packages/control-plane/README.md",
]);

const patterns = [
  { name: "stripe_live_secret", re: /sk_live_[a-zA-Z0-9]{16,}/ },
  { name: "stripe_test_secret", re: /sk_test_[a-zA-Z0-9]{16,}/ },
  { name: "stripe_webhook", re: /whsec_[a-zA-Z0-9]{16,}/ },
  { name: "private_key_block", re: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/ },
  { name: "supabase_service_role_jwt", re: /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+.*"role":"service_role"/ },
  { name: "openai_key", re: /sk-[a-zA-Z0-9]{20,}/ },
  { name: "resend_key", re: /re_[a-zA-Z0-9]{20,}/ },
];

const hits = [];

for (const rel of listTrackedFiles()) {
  if (rel.endsWith(".png") || rel.endsWith(".gif") || rel.endsWith(".jpg") || rel.endsWith(".webp")) continue;
  if (rel.includes("package-lock.json")) continue;
  let text;
  try {
    text = readFileSync(join(root, rel), "utf8");
  } catch {
    continue;
  }
  for (const { name, re } of patterns) {
    if (rel === "packages/core/src/entitlements.ts" && name === "private_key_block") continue;
    if (allowPaths.has(rel) && name === "private_key_block") continue;
    const m = text.match(re);
    if (m) {
      hits.push({ file: rel, pattern: name, sample: m[0].slice(0, 48) + "…" });
    }
  }
}

if (hits.length > 0) {
  console.error("verify-repo-secrets: forbidden patterns in tracked files:\n");
  for (const h of hits) {
    console.error(`  ${h.file} [${h.pattern}] ${h.sample}`);
  }
  process.exit(1);
}

console.log("verify-repo-secrets: ok");
