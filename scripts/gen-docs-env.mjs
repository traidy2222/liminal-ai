/**
 * Generates docs/reference/environment.md from harness inventory, defaults, and settings meta.
 * Run: npm run docs:gen
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const invPath = path.join(root, "packages/core/src/harness_env_inventory.ts");
const defaultsPath = path.join(root, "packages/core/src/harness_default_constants.ts");
const metaPath = path.join(root, "packages/core/src/harness_settings_field_meta.ts");
const outPath = path.join(root, "docs/reference/environment.md");

function parseManagedKeys(src) {
  const start = src.indexOf("HARNESS_MANAGED_ENV_KEYS");
  const slice = src.slice(start);
  const keys = [];
  for (const m of slice.matchAll(/"(AGENT_[A-Z0-9_]+)"/g)) {
    if (!keys.includes(m[1])) keys.push(m[1]);
  }
  return keys;
}

function parseSecretKeys(src) {
  const start = src.indexOf("HARNESS_SECRET_ENV_KEYS");
  const slice = src.slice(start, start + 800);
  const keys = new Set();
  for (const m of slice.matchAll(/"(AGENT_[A-Z0-9_]+|OPENROUTER_[A-Z0-9_]+|OPENAI_[A-Z0-9_]+|ANTHROPIC_[A-Z0-9_]+|XAI_[A-Z0-9_]+)"/g)) {
    keys.add(m[1]);
  }
  return keys;
}

function parseExportedStringConsts(src) {
  const map = {};
  for (const m of src.matchAll(/^export const ([A-Z0-9_]+)\s*=\s*"([^"]*)"\s*;/gm)) {
    map[m[1]] = m[2];
  }
  return map;
}

function parseDefaults(src, constMap) {
  const start = src.indexOf("HARNESS_ENV_DEFAULTS");
  const block = src.slice(start);
  const defaults = {};
  for (const m of block.matchAll(/\s+(AGENT_[A-Z0-9_]+):\s*(?:"([^"]*)"|([A-Z][A-Z0-9_]*))/g)) {
    const key = m[1];
    if (m[2] !== undefined) defaults[key] = m[2];
    else if (m[3] && constMap[m[3]]) defaults[key] = constMap[m[3]];
  }
  return defaults;
}

function parseFieldMeta(src) {
  const meta = {};
  const re = /^\s+"(AGENT_[A-Z0-9_]+)":\s*\{([^}]*)\}/gm;
  let m;
  while ((m = re.exec(src)) !== null) {
    const key = m[1];
    const body = m[2];
    const label = body.match(/label:\s*"([^"]*)"/)?.[1] ?? key;
    const desc = body.match(/description:\s*"([^"]*)"/)?.[1] ?? "";
    const tab = body.match(/tabId:\s*"([^"]*)"/)?.[1] ?? "";
    const subgroup = body.match(/subgroupId:\s*"([^"]*)"/)?.[1] ?? "";
    meta[key] = { label, desc, tab, subgroup };
  }
  return meta;
}

const inv = fs.readFileSync(invPath, "utf8");
const defaultsSrc = fs.readFileSync(defaultsPath, "utf8");
const metaSrc = fs.readFileSync(metaPath, "utf8");

const managed = parseManagedKeys(inv);
const secrets = parseSecretKeys(inv);
const defaultConstMap = parseExportedStringConsts(defaultsSrc);
const defaults = parseDefaults(defaultsSrc, defaultConstMap);
const fieldMeta = parseFieldMeta(metaSrc);

if (managed.length < 100) {
  throw new Error(`Expected 100+ managed keys, got ${managed.length}`);
}

const lines = [
  "# Environment reference",
  "",
  "> **Generated** by `npm run docs:gen` from `harness_env_inventory.ts`,",
  "> `harness_default_constants.ts`, and `harness_settings_field_meta.ts`.",
  "> Do not edit by hand.",
  "",
  "## Precedence",
  "",
  "1. `process.env` / `.env` (secrets and deploy overrides)",
  "2. `.agent_runtime_prefs.json` → `harness.env`",
  "3. `HARNESS_ENV_DEFAULTS` in `packages/core/src/harness_default_constants.ts`",
  "",
  "Web **Settings** writes to (2). See [Configuration basics](../start/configuration-basics.md).",
  "",
  "## Managed keys",
  "",
  "| Key | Default | Settings | Secret | Tab | Description |",
  "|-----|---------|----------|--------|-----|-------------|",
];

for (const key of managed.sort()) {
  const def = defaults[key] ?? "—";
  const inSettings = "yes";
  const isSecret = secrets.has(key) ? "yes" : "no";
  const fm = fieldMeta[key];
  const tab = fm?.tab ?? "";
  const desc = (fm?.desc ?? fm?.label ?? "").replace(/\|/g, "\\|").slice(0, 120);
  lines.push(`| \`${key}\` | \`${def}\` | ${inSettings} | ${isSecret} | ${tab} | ${desc} |`);
}

lines.push("");
lines.push("## Secret keys (.env only)");
lines.push("");
for (const k of [...secrets].sort()) {
  lines.push(`- \`${k}\``);
}
lines.push("");
lines.push("## Related");
lines.push("");
lines.push("- [Configuration reference](../configuration.md) — narrative groups");
lines.push("- Repo root `CLAUDE.md` — contributor quick reference (not linked; lives outside `docs/`)");
lines.push("");

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, lines.join("\n"), "utf8");
console.log(`Wrote ${outPath} (${managed.length} keys)`);
