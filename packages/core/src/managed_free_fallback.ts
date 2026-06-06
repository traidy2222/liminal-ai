/**
 * When Vireon managed-inference credits are exhausted (HTTP 402), optionally
 * route through the user's OpenRouter BYOK key on free models (openrouter/free + Nemotron 3 Ultra fast).
 */
import { DEFAULT_AGENT_API_BASE_URL } from "./harness_default_constants.js";
import { resolveHarnessEnvRaw } from "./harness_effective_env.js";
import {
  buildHarnessModelPackEnvPatch,
  OPENROUTER_MODEL_SLUG,
} from "./provider_model_presets.js";
import { isOpenRouterStealthModel } from "./provider_config.js";
import type { RuntimePreferences } from "./runtime_prefs.js";

export {
  isInferenceBudgetExceededError,
  isManagedInferenceAuthError,
} from "./inference_provider.js";

export function managedFreeFallbackEnabled(prefs?: RuntimePreferences | null): boolean {
  return resolveHarnessEnvRaw("AGENT_MANAGED_FREE_FALLBACK", prefs ?? null) !== "0";
}

export function resolveManagedFreeFallbackMainModel(prefs?: RuntimePreferences | null): string {
  const raw = resolveHarnessEnvRaw("AGENT_MANAGED_FREE_FALLBACK_MODEL", prefs ?? null)?.trim();
  return raw || OPENROUTER_MODEL_SLUG.FREE_ROUTER;
}

export function resolveManagedFreeFallbackFastModel(
  main: string,
  prefs?: RuntimePreferences | null
): string {
  const raw = resolveHarnessEnvRaw("AGENT_MANAGED_FREE_FALLBACK_FAST", prefs ?? null)?.trim();
  if (raw) return raw;
  if (main === OPENROUTER_MODEL_SLUG.FREE_ROUTER) {
    return OPENROUTER_MODEL_SLUG.NEMOTRON_3_ULTRA_FREE;
  }
  return main;
}

/** Harness env patch for a free OpenRouter model (Stealth pin when owl-alpha). */
export function buildManagedFreeFallbackHarnessEnv(
  prefs?: RuntimePreferences | null
): Record<string, string> {
  const main = resolveManagedFreeFallbackMainModel(prefs);
  const fast = resolveManagedFreeFallbackFastModel(main, prefs);
  if (isOpenRouterStealthModel(main)) {
    return buildHarnessModelPackEnvPatch({
      main,
      fast,
      baseURL: DEFAULT_AGENT_API_BASE_URL,
      providerStrategy: "cache_first",
      providerOrder: "Stealth",
      providerOrderFast: "Stealth",
      providerRouteAuto: "0",
      allowFallbacks: "0",
    });
  }
  return buildHarnessModelPackEnvPatch({
    main,
    fast,
    baseURL: DEFAULT_AGENT_API_BASE_URL,
    providerStrategy: "price",
    providerOrder: "",
    providerOrderFast: "",
    providerRouteAuto: "1",
    allowFallbacks: "1",
  });
}
