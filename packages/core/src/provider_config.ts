import {
  DEFAULT_AGENT_API_BASE_URL,
  DEFAULT_AGENT_MODEL_SLUG,
  HARNESS_ENV_DEFAULTS,
} from "./harness_default_constants.js";
import { effectiveHarnessEnvRaw } from "./harness_effective_env.js";

// ─── Provider routing (OpenRouter sticky cache) ───────────────────────────────

export interface ProviderRouting {
  /** Preferred provider order (e.g. ["DeepSeek"]). OpenRouter tries them in order. */
  order: string[];
  /** Fall back to other providers if preferred are unavailable. Default true. */
  allow_fallbacks: boolean;
}

/** Map model slug prefix → OpenRouter provider display name. */
const SLUG_PREFIX_TO_PROVIDER: Record<string, string> = {
  deepseek: "DeepSeek",
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  qwen: "Qwen",
  mistralai: "Mistral",
  meta: "Meta",
  cohere: "Cohere",
  "x-ai": "xAI",
  xai: "xAI",
};

/** OpenRouter slugs that only accept the Stealth provider (not DeepInfra / vendor pins). */
export const OPENROUTER_STEALTH_MODEL_SLUGS: readonly string[] = ["openrouter/owl-alpha"];

export function isOpenRouterStealthModel(modelSlug: string): boolean {
  const s = modelSlug.trim().toLowerCase();
  return OPENROUTER_STEALTH_MODEL_SLUGS.some((m) => m.toLowerCase() === s);
}

function deriveProviderFromModelSlug(slug: string): string | null {
  const prefix = slug.split("/")[0]?.toLowerCase() ?? "";
  return SLUG_PREFIX_TO_PROVIDER[prefix] ?? null;
}

/**
 * Builds the `provider` routing object for OpenRouter requests.
 * Pinning to a single provider is the primary mechanism for cache affinity —
 * each provider maintains its own KV cache, so random load-balancing breaks it.
 *
 * @param modelSlug - The model slug being called (used for auto-derive).
 * @param isFastModel - When true, checks `AGENT_PROVIDER_ORDER_FAST` before the main key.
 * Returns null when auto-routing is disabled or provider cannot be inferred.
 */
export function buildProviderRouting(
  modelSlug: string,
  isFastModel = false
): ProviderRouting | null {
  const allowFallbacks =
    effectiveHarnessEnvRaw("AGENT_PROVIDER_ALLOW_FALLBACKS")?.trim() !== "0";

  // Stealth-only models — global DeepInfra/DeepSeek pins cause HTTP 404 on OpenRouter.
  if (isOpenRouterStealthModel(modelSlug)) {
    return { order: ["Stealth"], allow_fallbacks: allowFallbacks };
  }

  // Fast model has its own provider order (sidecar calls: intent, distill, critic, rewrite)
  if (isFastModel) {
    const fastExplicit = effectiveHarnessEnvRaw("AGENT_PROVIDER_ORDER_FAST")?.trim();
    if (fastExplicit && fastExplicit.length > 0) {
      const order = fastExplicit
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (order.length > 0) return { order, allow_fallbacks: allowFallbacks };
    }
  }

  // Explicit comma-separated order for main model (also used as fast fallback if FAST unset)
  const explicit = effectiveHarnessEnvRaw("AGENT_PROVIDER_ORDER")?.trim();
  if (explicit && explicit.length > 0) {
    const order = explicit
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (order.length > 0) return { order, allow_fallbacks: allowFallbacks };
  }

  const auto = effectiveHarnessEnvRaw("AGENT_PROVIDER_ROUTE_AUTO")?.trim();
  if (auto === "0") return null;

  const derived = deriveProviderFromModelSlug(modelSlug);
  if (!derived) return null;
  return { order: [derived], allow_fallbacks: allowFallbacks };
}

const DEFAULT_BASE_URL = DEFAULT_AGENT_API_BASE_URL;
const DEFAULT_MODEL = DEFAULT_AGENT_MODEL_SLUG;

export interface ProviderConfig {
  apiKey: string;
  baseURL: string;
  model: string;
  keySource:
    | "AGENT_API_KEY"
    | "OPENROUTER_API_KEY"
    | "OPENAI_API_KEY"
    | "ANTHROPIC_API_KEY"
    | "XAI_API_KEY";
}

export interface ProviderConfigOverrides {
  baseURL?: string;
  model?: string;
  keySource?: ProviderConfig["keySource"];
}

export interface VisionProviderConfig {
  apiKey: string;
  baseURL: string;
  model: string;
}

function firstNonEmpty(
  keys: Array<ProviderConfig["keySource"]>
): { key: ProviderConfig["keySource"]; value: string } | null {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return { key, value };
  }
  return null;
}

export function resolveProviderConfig(overrides?: ProviderConfigOverrides): ProviderConfig {
  const order: Array<ProviderConfig["keySource"]> = overrides?.keySource
    ? [overrides.keySource, "AGENT_API_KEY", "OPENROUTER_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "XAI_API_KEY"]
    : ["AGENT_API_KEY", "OPENROUTER_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "XAI_API_KEY"];
  const picked = firstNonEmpty(order);
  if (!picked) {
    throw new Error(
      "No API key found. Set AGENT_API_KEY (preferred) or one of OPENROUTER_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY / XAI_API_KEY."
    );
  }
  const baseURL = (overrides?.baseURL ?? process.env["AGENT_API_BASE_URL"]?.trim()) || DEFAULT_BASE_URL;
  const model = (overrides?.model ?? process.env["AGENT_MODEL"]?.trim()) || DEFAULT_MODEL;
  return {
    apiKey: picked.value,
    baseURL,
    model,
    keySource: picked.key,
  };
}

/**
 * Vision sidecar config — never silently inherit the primary chat model.
 * Uses effectiveHarnessEnvRaw (env → prefs → product defaults) so local AGENT_MODEL
 * does not override AGENT_VISION_MODEL when vision keys are unset in .env.
 */
export function resolveVisionProviderConfig(): VisionProviderConfig {
  const base = resolveProviderConfig();
  const defaultModel = HARNESS_ENV_DEFAULTS["AGENT_VISION_MODEL"]?.trim() ?? "";
  const defaultBase =
    HARNESS_ENV_DEFAULTS["AGENT_VISION_BASE_URL"]?.trim() || DEFAULT_BASE_URL;
  return {
    apiKey: effectiveHarnessEnvRaw("AGENT_VISION_API_KEY")?.trim() || base.apiKey,
    baseURL: effectiveHarnessEnvRaw("AGENT_VISION_BASE_URL")?.trim() || defaultBase,
    model: effectiveHarnessEnvRaw("AGENT_VISION_MODEL")?.trim() || defaultModel,
  };
}
