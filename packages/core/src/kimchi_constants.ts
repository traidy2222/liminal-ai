/**
 * Kimchi / Cast AI constants — extracted to avoid circular imports.
 * Imports only from harness_effective_env (no provider/router dependencies).
 */

/** Cast AI API base URL. */
export const KIMCHI_API_BASE_URL = "https://llm.cast.ai/openai/v1";

/** Cast AI model slugs (user-deployed + model library). */
export const KIMCHI_MODEL_SLUG = {
  MINIMAX_M27: "minimax-m2.7",
  KIMI_K25: "kimi-k2.5",
  KIMI_K26: "kimi-k2.6",
  MINIMAX_M25: "minimax-m2.5",
  NEMOTRON_3_SUPER_FP4: "nemotron-3-super-fp4",
} as const;

/** True when the configured API base is Cast AI / Kimchi. */
export function isKimchiApiBaseUrl(baseURL: string | undefined | null): boolean {
  const raw = (baseURL ?? "").trim();
  if (!raw) return false;
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return host === "llm.cast.ai" || host === "llm.kimchi.dev" || host.endsWith(".kimchi.dev");
  } catch {
    return /llm\.cast\.ai|llm\.kimchi\.dev/i.test(raw);
  }
}
