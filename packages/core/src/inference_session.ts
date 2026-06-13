/**
 * In-process cache for Vireon managed-inference session JWTs (15m TTL).
 * Refreshed automatically before expiry on each root send().
 */
import type { RuntimePreferences } from "./runtime_prefs.js";
import { clearInferenceUsageStatusCache, fetchInferenceSession } from "./inference_provider.js";

const REFRESH_BUFFER_MS = 2 * 60_000;

let cached: { token: string; expiresAtMs: number; baseURL: string } | null = null;

export function isManagedInferenceBaseUrl(baseURL: string): boolean {
  return baseURL.replace(/\/$/, "").includes("/inference");
}

export function clearManagedInferenceSessionCache(): void {
  cached = null;
  clearInferenceUsageStatusCache();
}

export async function ensureManagedInferenceSession(
  prefs?: RuntimePreferences | null,
  currentBaseURL?: string
): Promise<{ apiKey: string; baseURL: string } | null> {
  const base = (currentBaseURL ?? cached?.baseURL ?? "").replace(/\/$/, "");
  if (!base || !isManagedInferenceBaseUrl(base)) return null;

  const now = Date.now();
  if (cached && cached.expiresAtMs - now > REFRESH_BUFFER_MS && cached.baseURL === base) {
    return { apiKey: cached.token, baseURL: cached.baseURL };
  }

  const session = await fetchInferenceSession(prefs);
  const expiresAtMs = Date.parse(session.expiresAt);
  cached = {
    token: session.token,
    expiresAtMs: Number.isFinite(expiresAtMs) ? expiresAtMs : now + 14 * 60_000,
    baseURL: session.baseURL.replace(/\/$/, ""),
  };
  return { apiKey: cached.token, baseURL: cached.baseURL };
}
