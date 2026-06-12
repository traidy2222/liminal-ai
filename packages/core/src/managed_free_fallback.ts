/**
 * When Vireon managed-inference credits are exhausted (HTTP 402), optionally
 * route through the user's OpenRouter BYOK key on free models (openrouter/free + Nemotron 3 Ultra fast).
 */
import {
  DEFAULT_AGENT_API_BASE_URL,
  DEFAULT_AGENT_FAST_MODEL_SLUG,
  DEFAULT_AGENT_MODEL_SLUG,
} from "./harness_default_constants.js";
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

/** OpenRouter-only slugs that the Vireon managed proxy rejects (Bedrock chat path). */
export function isModelIncompatibleWithManagedProxy(model: string): boolean {
  const m = model.trim().toLowerCase();
  if (!m) return false;
  if (m === OPENROUTER_MODEL_SLUG.FREE_ROUTER) return true;
  if (m.startsWith("openrouter/")) return true;
  if (m.includes(":free")) return true;
  if (m === resolveManagedFreeFallbackMainModel(null).toLowerCase()) return true;
  return false;
}

/** Pick a managed-routable model when prefs still carry a BYOK free-fallback slug. */
export function resolveModelForManagedInference(
  currentModel: string | undefined,
  prefs?: RuntimePreferences | null
): string {
  const cur = currentModel?.trim() ?? "";
  if (cur && !isModelIncompatibleWithManagedProxy(cur)) return cur;
  const fromProvider = prefs?.provider?.model?.trim();
  if (fromProvider && !isModelIncompatibleWithManagedProxy(fromProvider)) return fromProvider;
  const fromEnv = resolveHarnessEnvRaw("AGENT_MODEL", prefs ?? null)?.trim();
  if (fromEnv && !isModelIncompatibleWithManagedProxy(fromEnv)) return fromEnv;
  return DEFAULT_AGENT_MODEL_SLUG;
}

/** Harness env patch when switching back from credit-exhaustion BYOK fallback. */
export function buildManagedRecoveryHarnessEnv(
  prefs: RuntimePreferences | null,
  model: string
): Record<string, string> {
  return {
    AGENT_INFERENCE_MODE: "managed",
    AGENT_INFERENCE_PREFER_MANAGED: "1",
    AGENT_MODEL: model,
    AGENT_API_BASE_URL: DEFAULT_AGENT_API_BASE_URL,
    AGENT_PROVIDER_ORDER: "",
    AGENT_PROVIDER_ORDER_FAST: "",
    AGENT_PROVIDER_STRATEGY: "price",
    AGENT_PROVIDER_ROUTE_AUTO: "1",
    AGENT_PROVIDER_ALLOW_FALLBACKS: "1",
    ...(prefs?.harness?.env?.AGENT_FAST_MODEL &&
    isModelIncompatibleWithManagedProxy(prefs.harness.env.AGENT_FAST_MODEL)
      ? { AGENT_FAST_MODEL: DEFAULT_AGENT_FAST_MODEL_SLUG }
      : {}),
  };
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
