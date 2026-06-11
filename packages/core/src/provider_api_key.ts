/**
 * Resolve BYOK provider API keys from process.env and on-disk `.env` files
 * (desktop bundle: `liminald/repo/.env` may not be in process.env until read).
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isKimchiApiBaseUrl } from "./kimchi_provider.js";
import { isOpenRouterApiBaseUrl } from "./openrouter_session.js";

export const PROVIDER_API_KEY_ENV_NAMES = [
  "AGENT_API_KEY",
  "OPENROUTER_API_KEY",
  "KIMCHI_API_KEY",
  "CASTAI_API_KEY",
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

/** Cast AI / Kimchi API keys use the `castai_v1_` prefix. */
export function isCastAiApiKey(value: string | undefined | null): boolean {
  return /^castai_v1_/i.test((value ?? "").trim());
}

/** First non-empty provider key from env vars or `.env` files. */
export function resolveLocalProviderApiKey(): string | undefined {
  ensureProviderApiKeysInProcess();
  for (const name of PROVIDER_API_KEY_ENV_NAMES) {
    const v = process.env[name]?.trim();
    if (v) return v;
  }
  return undefined;
}

/**
 * Load provider API keys from `.env` files into `process.env` (desktop bundle).
 * Does not override keys already set in the process environment.
 */
export function ensureProviderApiKeysInProcess(): void {
  for (const file of providerApiKeyEnvFileCandidates()) {
    const parsed = readDotEnvFile(file);
    for (const name of PROVIDER_API_KEY_ENV_NAMES) {
      const v = parsed[name]?.trim();
      if (v && !process.env[name]?.trim()) {
        process.env[name] = v;
      }
    }
  }
}

/**
 * Hydrate provider keys from disk and return the first resolved key.
 * Also mirrors the first found key into `AGENT_API_KEY` when unset (legacy callers).
 * Never mirrors Cast AI keys — that breaks OpenRouter after switching off Kimchi.
 */
export function ensureLocalProviderApiKeyInProcess(): string | undefined {
  ensureProviderApiKeysInProcess();
  const key = resolveLocalProviderApiKey();
  if (key && !process.env["AGENT_API_KEY"]?.trim() && !isCastAiApiKey(key)) {
    process.env["AGENT_API_KEY"] = key;
  }
  return key;
}

/**
 * Drop stale in-process keys after switching provider backend (Kimchi ↔ OpenRouter).
 * `.env` files are authoritative; `AGENT_API_KEY` must not keep a Cast key on OpenRouter.
 */
export function syncProviderProcessEnvForBase(baseURL: string): void {
  ensureProviderApiKeysInProcess();
  const agent = process.env["AGENT_API_KEY"]?.trim();
  if (!agent) return;
  if (isOpenRouterApiBaseUrl(baseURL) && isCastAiApiKey(agent)) {
    delete process.env["AGENT_API_KEY"];
  }
  if (isKimchiApiBaseUrl(baseURL) && !isCastAiApiKey(agent)) {
    const hasKimchi =
      process.env["KIMCHI_API_KEY"]?.trim() || process.env["CASTAI_API_KEY"]?.trim();
    if (hasKimchi) delete process.env["AGENT_API_KEY"];
  }
}

