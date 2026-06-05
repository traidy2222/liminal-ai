/**
 * Resolve BYOK provider API keys from process.env and on-disk `.env` files
 * (desktop bundle: `liminald/repo/.env` may not be in process.env until read).
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const PROVIDER_API_KEY_ENV_NAMES = [
  "AGENT_API_KEY",
  "OPENROUTER_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "XAI_API_KEY",
] as const;

function parseDotEnv(content: string): Record<string, string> {
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

function readDotEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  try {
    return parseDotEnv(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

/** Candidate `.env` paths (repo bundle, user override). */
export function providerApiKeyEnvFileCandidates(): string[] {
  const paths: string[] = [];
  const repo = process.env["LIMINAL_REPO_ROOT"]?.trim();
  if (repo) paths.push(join(repo, ".env"));
  paths.push(join(homedir(), ".liminal", ".env"));
  return paths;
}

/** First non-empty provider key from env vars or `.env` files. */
export function resolveLocalProviderApiKey(): string | undefined {
  for (const name of PROVIDER_API_KEY_ENV_NAMES) {
    const v = process.env[name]?.trim();
    if (v) return v;
  }
  for (const file of providerApiKeyEnvFileCandidates()) {
    const parsed = readDotEnvFile(file);
    for (const name of PROVIDER_API_KEY_ENV_NAMES) {
      const v = parsed[name]?.trim();
      if (v) return v;
    }
  }
  return undefined;
}

/**
 * Hydrate `AGENT_API_KEY` into process.env when only present on disk (desktop bundle).
 * Returns the resolved key when found.
 */
export function ensureLocalProviderApiKeyInProcess(): string | undefined {
  const key = resolveLocalProviderApiKey();
  if (key && !process.env["AGENT_API_KEY"]?.trim()) {
    process.env["AGENT_API_KEY"] = key;
  }
  return key;
}
