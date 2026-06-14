/**
 * Kimchi / Cast AI — OpenAI-compatible inference (https://llm.cast.ai).
 * Models are deployed per account; slugs match the Cast AI dashboard.
 */
import OpenAI from "openai";
import { resolveHarnessEnvRaw } from "./harness_effective_env.js";
import { isOpaqueInferenceProviderError, errorMessage } from "./openrouter_errors.js";
import type { RuntimePreferences } from "./runtime_prefs.js";
import { isKimchiApiBaseUrl as isKimchiApiBaseUrlImpl, KIMCHI_API_BASE_URL, KIMCHI_MODEL_SLUG } from "./kimchi_constants.js";

export { KIMCHI_API_BASE_URL, KIMCHI_MODEL_SLUG };

export function isKimchiApiBaseUrl(baseURL: string | undefined | null): boolean {
  return isKimchiApiBaseUrlImpl(baseURL);
}

export const KIMCHI_API_KEY_ENV_NAMES = ["KIMCHI_API_KEY", "CASTAI_API_KEY"] as const;

export type KimchiApiKeyEnvName = (typeof KIMCHI_API_KEY_ENV_NAMES)[number];

/** Default ms between Kimchi requests when AGENT_PROVIDER_MIN_INTERVAL_MS is unset (RPM protection). */
export const KIMCHI_DEFAULT_MIN_INTERVAL_MS = 1_500;

/** Max retries for transient Cast AI errors (opaque 400, 429, 5xx). */
export function resolveKimchiTransientMaxRetries(prefs?: RuntimePreferences | null): number {
  const raw = resolveHarnessEnvRaw("AGENT_KIMCHI_TRANSIENT_MAX_RETRIES", prefs ?? null)?.trim();
  const n = parseInt(raw ?? "8", 10);
  return Number.isFinite(n) && n >= 0 ? n : 8;
}

/** Min spacing between Kimchi completions (see docs.cast.ai rate limits). */
export function resolveKimchiMinIntervalMs(prefs?: RuntimePreferences | null): number {
  const raw = resolveHarnessEnvRaw("AGENT_KIMCHI_MIN_INTERVAL_MS", prefs ?? null)?.trim();
  const n = parseInt(raw ?? String(KIMCHI_DEFAULT_MIN_INTERVAL_MS), 10);
  return Number.isFinite(n) && n >= 0 ? Math.min(120_000, n) : KIMCHI_DEFAULT_MIN_INTERVAL_MS;
}

/**
 * Cast AI 429 bodies: `{"error":"minimax-m2.7 model is rate limited until 2026-02-05T15:32:41Z"}`.
 * @see https://docs.cast.ai/docs/ai-enabler-reference-rate-limits
 */
export function parseKimchiRateLimitRetryAfterMs(err: unknown): number | null {
  const parts: string[] = [];
  if (err instanceof OpenAI.APIError) {
    if (typeof err.error === "object" && err.error !== null) {
      parts.push(JSON.stringify(err.error));
    } else if (err.error != null) {
      parts.push(String(err.error));
    }
    parts.push(err.message);
  }
  parts.push(errorMessage(err));
  const msg = parts.join(" ");
  const until = msg.match(/rate\s+limited\s+until\s+(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/i);
  if (until?.[1]) {
    const ts = Date.parse(until[1]);
    if (Number.isFinite(ts)) return Math.max(0, ts - Date.now());
  }
  return null;
}

/** Kimchi throttling should retry/backoff, not trip the global provider circuit breaker. */
export function isKimchiThrottleError(err: unknown, baseURL?: string): boolean {
  if (!isKimchiApiBaseUrl(baseURL)) return false;
  return isKimchiRetryableProviderError(err);
}

/**
 * Cast AI sometimes returns HTTP 400 with an empty body under load — treat as transient.
 * Validation errors (unknown model, bad JSON schema) are not retried.
 */
export function isKimchiRetryableProviderError(err: unknown): boolean {
  if (err instanceof OpenAI.RateLimitError) return true;
  if (err instanceof OpenAI.InternalServerError) return true;
  if (err instanceof OpenAI.APIConnectionError) return true;
  if (err instanceof OpenAI.APIError) {
    if (err.status === 429) return true;
    if (err.status != null && err.status >= 500) return true;
    if (err.status === 400) {
      if (isOpaqueInferenceProviderError(err)) return true;
      const body =
        typeof err.error === "object" && err.error !== null
          ? JSON.stringify(err.error)
          : String(err.error ?? err.message ?? "");
      const lower = body.toLowerCase();
      if (/invalid|unknown model|not found|does not exist|context length|too many tokens/.test(lower)) {
        return false;
      }
      return /overloaded|capacity|temporarily unavailable|try again|rate.?limit|rate limited until|too many requests/.test(
        lower
      );
    }
  }
  const msg = errorMessage(err).toLowerCase();
  return /econnreset|etimedout|fetch failed|socket hang up|und_err_socket/.test(msg);
}

export function formatKimchiProviderError(
  err: unknown,
  opts?: { retriesExhausted?: boolean }
): string | null {
  if (err instanceof OpenAI.APIError && err.status === 401) {
    return (
      "Cast AI (Kimchi) HTTP 401 Unauthorized. Set KIMCHI_API_KEY (castai_v1_…) in Settings — " +
      "an OpenRouter key cannot authenticate to llm.cast.ai. Create keys in the Cast AI console."
    );
  }
  if (!(err instanceof OpenAI.APIError) || err.status !== 400) return null;
  if (!isKimchiRetryableProviderError(err) && !isOpaqueInferenceProviderError(err)) return null;
  if (opts?.retriesExhausted) {
    return (
      "Cast AI (Kimchi) returned HTTP 400 after retries. " +
      "Confirm the model slug is deployed in your Cast AI dashboard, wait a minute, or try another Kimchi preset."
    );
  }
  return "Cast AI (Kimchi) transient HTTP 400 — retrying…";
}
