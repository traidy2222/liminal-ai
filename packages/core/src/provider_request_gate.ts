/**
 * Global spacing queue for OpenAI-compatible providers (OpenRouter, etc.).
 * Bursts from parallel tools + main chat + embeddings share one account RPM/RPS
 * budget; optional minimum interval caps request starts per credential pair.
 */
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { effectiveHarnessEnvRaw, currentHarnessPreferences, harnessEnvResolutionMeta } from "./harness_effective_env.js";
import { isKimchiApiBaseUrl, resolveKimchiMinIntervalMs } from "./kimchi_provider.js";

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
export function resolveProviderMinIntervalMs(baseURL?: string): number {
  const raw = effectiveHarnessEnvRaw("AGENT_PROVIDER_MIN_INTERVAL_MS")?.trim();
  const prefs = currentHarnessPreferences();
  const meta = harnessEnvResolutionMeta("AGENT_PROVIDER_MIN_INTERVAL_MS", prefs);
  if (raw && (!isKimchiApiBaseUrl(baseURL) || meta.source !== "product_default")) {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n)) return Math.max(0, Math.min(120_000, n));
  }
  if (isKimchiApiBaseUrl(baseURL)) {
    return resolveKimchiMinIntervalMs(prefs);
  }
  return 0;
}

/**
 * Runs `fn` after honoring optional global spacing for this API key + base URL.
 * Only request starts are serialized; responses and nested calls can progress independently.
 */
export async function withProviderRequestSpacing<T>(
  creds: ProviderCredentials,
  fn: () => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  signal?.throwIfAborted();
  const intervalMs = resolveProviderMinIntervalMs(creds.baseURL);
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
  const start = prev.then(async () => {
    signal?.throwIfAborted();
    const now = Date.now();
    const wait = Math.max(0, entry!.nextAllowedAt - now);
    if (wait > 0) {
      await delay(wait, undefined, { signal });
    }
    signal?.throwIfAborted();
    entry!.nextAllowedAt = Date.now() + intervalMs;
  });
  entry.tail = start.then(
    () => undefined,
    () => undefined
  );
  // Return promptly on abort even while earlier start reservations are queued.
  // The queued start still checks the signal, so cancellation cannot launch fn later.
  if (signal) {
    await new Promise<void>((resolve, reject) => {
      const abort = () => { cleanup(); reject(signal.reason); };
      const cleanup = () => signal.removeEventListener("abort", abort);
      signal.addEventListener("abort", abort, { once: true });
      start.then(() => { cleanup(); resolve(); }, error => { cleanup(); reject(error); });
      if (signal.aborted) abort();
    });
  } else await start;
  signal?.throwIfAborted();
  return fn();
}
