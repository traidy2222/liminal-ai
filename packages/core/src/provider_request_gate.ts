/**
 * Global spacing queue for OpenAI-compatible providers (OpenRouter, etc.).
 * Bursts from parallel tools + main chat + embeddings share one account RPM/RPS
 * budget; optional minimum interval caps request starts per credential pair.
 */
import { createHash } from "node:crypto";
import { effectiveHarnessEnvRaw } from "./harness_effective_env.js";

export interface ProviderCredentials {
  apiKey: string;
  baseURL: string;
}

type ChainEntry = { tail: Promise<unknown>; nextAllowedAt: number };

const chains = new Map<string, ChainEntry>();

function normalizeBaseUrl(baseURL: string): string {
  return baseURL.trim().replace(/\/$/, "");
}

/** Stable, non-reversible id for a key + endpoint (used only for in-process queue bucketing). */
export function providerSpacingKey(creds: ProviderCredentials): string {
  const base = normalizeBaseUrl(creds.baseURL);
  const key = creds.apiKey.trim();
  return createHash("sha256").update(`${base}\n${key}`).digest("hex").slice(0, 32);
}

/** Minimum ms between the *start* of consecutive requests sharing the same key. 0 = disabled. */
export function resolveProviderMinIntervalMs(): number {
  const raw = effectiveHarnessEnvRaw("AGENT_PROVIDER_MIN_INTERVAL_MS")?.trim();
  if (!raw) return 0;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(120_000, n));
}

/**
 * Runs `fn` after honoring optional global spacing for this API key + base URL.
 * Safe to nest (inner calls extend the same chain).
 */
export async function withProviderRequestSpacing<T>(
  creds: ProviderCredentials,
  fn: () => Promise<T>
): Promise<T> {
  const intervalMs = resolveProviderMinIntervalMs();
  if (intervalMs <= 0) {
    return fn();
  }
  const key = providerSpacingKey(creds);
  let entry = chains.get(key);
  if (!entry) {
    entry = { tail: Promise.resolve(), nextAllowedAt: 0 };
    chains.set(key, entry);
  }
  const prev = entry.tail;
  const run = prev.then(async () => {
    const now = Date.now();
    const wait = Math.max(0, entry!.nextAllowedAt - now);
    if (wait > 0) {
      await new Promise<void>((r) => setTimeout(r, wait));
    }
    try {
      return await fn();
    } finally {
      entry!.nextAllowedAt = Date.now() + intervalMs;
    }
  });
  entry.tail = run.then(
    () => undefined,
    () => undefined
  );
  return run as Promise<T>;
}
