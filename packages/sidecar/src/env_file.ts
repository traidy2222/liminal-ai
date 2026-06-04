import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const API_KEY_VARS = [
  "AGENT_API_KEY",
  "OPENROUTER_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "XAI_API_KEY",
] as const;

function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function formatEnvFile(env: Record<string, string>): string {
  const lines = ["# Liminal — managed by the desktop app", ""];
  for (const [k, v] of Object.entries(env)) {
    lines.push(`${k}=${v}`);
  }
  lines.push("");
  return lines.join("\n");
}

/** Merge updates into `<repoRoot>/.env` (creates the file if missing). */
export function writeEnvMerge(repoRoot: string, updates: Record<string, string>): void {
  const envPath = join(repoRoot, ".env");
  const merged = existsSync(envPath) ? parseEnvFile(readFileSync(envPath, "utf8")) : {};
  for (const [k, v] of Object.entries(updates)) {
    if (v.trim()) merged[k] = v.trim();
  }
  writeFileSync(envPath, formatEnvFile(merged), { encoding: "utf8", mode: 0o600 });
}

export function firstApiKeyFromEnv(repoRoot: string): string | null {
  const envPath = join(repoRoot, ".env");
  if (!existsSync(envPath)) return null;
  const parsed = parseEnvFile(readFileSync(envPath, "utf8"));
  for (const key of API_KEY_VARS) {
    const v = parsed[key]?.trim();
    if (v) return v;
  }
  return null;
}

export function applyApiKeyToProcess(apiKey: string): void {
  process.env["AGENT_API_KEY"] = apiKey.trim();
}
