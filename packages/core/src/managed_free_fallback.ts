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
import { buildHarnessModelPackEnvPatch } from "./provider_model_pack.js";
import { isOpenRouterFusionModel } from "./openrouter_fusion.js";
import { isOpenRouterStealthModel } from "./provider_config.js";
import type { RuntimePreferences } from "./runtime_prefs.js";

/** Default main model when managed credits are exhausted (OpenRouter free router). */
const MANAGED_FREE_FALLBACK_MAIN_SLUG = "openrouter/free";
/** Fast sidecar when main is the free router. */
const MANAGED_FREE_FALLBACK_FAST_SLUG = "nvidia/nemotron-3-ultra-550b-a55b:free";

export function managedFreeFallbackEnabled(prefs?: RuntimePreferences | null): boolean {
  return resolveHarnessEnvRaw("AGENT_MANAGED_FREE_FALLBACK", prefs ?? null) !== "0";
}

export function resolveManagedFreeFallbackMainModel(prefs?: RuntimePreferences | null): string {
  const userModel =
    prefs?.provider?.model?.trim() ||
    resolveHarnessEnvRaw("AGENT_MODEL", prefs ?? null)?.trim() ||
    "";
  if (userModel && isUserIntentOpenRouterOnlyModel(userModel)) {
    return userModel;
  }
  const raw = resolveHarnessEnvRaw("AGENT_MANAGED_FREE_FALLBACK_MODEL", prefs ?? null)?.trim();
  return raw || MANAGED_FREE_FALLBACK_MAIN_SLUG;
}

/** User-picked OpenRouter-only slug (no recursive default-model lookup). */
export function isUserIntentOpenRouterOnlyModel(model: string): boolean {
  const m = model.trim().toLowerCase();
  if (!m) return false;
  if (isOpenRouterFusionModel(m)) return false;
  if (m.startsWith("openrouter/")) return true;
  if (m.includes(":free")) return true;
  return false;
}

/**
 * Legacy name — all catalog slugs are routable via managed inference (Bedrock /
 * OpenRouter / Kimchi upstream selected per model). Kept for callers that
 * gate UX on "needs a specific upstream"; never blocks managed routing.
 */
export function isModelIncompatibleWithManagedProxy(_model: string): boolean {
  return false;
}

/** True when the slug is natively an OpenRouter vendor/model id (not Bedrock/Kimchi shape). */
export function isOpenRouterCatalogModel(model: string): boolean {
  const m = model.trim().toLowerCase();
  if (!m) return false;
  if (isOpenRouterFusionModel(m)) return true;
  if (m.startsWith("openrouter/")) return true;
  if (m.includes(":free")) return true;
  if (m.includes("/")) return true;
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
  if (main === MANAGED_FREE_FALLBACK_MAIN_SLUG) {
    return MANAGED_FREE_FALLBACK_FAST_SLUG;
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
