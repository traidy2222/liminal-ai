/**
 * OpenRouter model packs — one-click switch for main + fast + sidecar model slots.
 * Consumed by web Settings and setup scripts (browser imports via package export).
 */
import {
  DEFAULT_AGENT_API_BASE_URL,
  DEFAULT_AGENT_FAST_MODEL_SLUG,
  DEFAULT_AGENT_MODEL_SLUG,
} from "./harness_default_constants.js";

/** OpenRouter slugs (see https://openrouter.ai/models). */
export const OPENROUTER_MODEL_SLUG = {
  DEEPSEEK_V4_PRO: "deepseek/deepseek-v4-pro",
  DEEPSEEK_V4_FLASH: "deepseek/deepseek-v4-flash",
  MIMO_V25_PRO: "xiaomi/mimo-v2.5-pro",
  MIMO_V25: "xiaomi/mimo-v2.5",
} as const;

export interface ProviderModelPreset {
  id: string;
  label: string;
  hint: string;
  baseURL: string;
  /** Main ReAct model (`AGENT_MODEL` + provider.model). */
  model: string;
  /** Harness env keys applied with the preset (includes `AGENT_MODEL`). */
  harnessEnvPatch: Record<string, string>;
}

/**
 * Patch every harness-managed model slot that should track the main/fast tier.
 * Embeddings, vision, and transcription stay on product defaults (cross-model).
 */
export function buildHarnessModelPackEnvPatch(opts: {
  main: string;
  fast: string;
  baseURL?: string;
  providerOrder?: string;
  providerOrderFast?: string;
  providerRouteAuto?: string;
  allowFallbacks?: string;
}): Record<string, string> {
  const fast = opts.fast.trim();
  const main = opts.main.trim();
  const patch: Record<string, string> = {
    AGENT_MODEL: main,
    AGENT_FAST_MODEL: fast,
    AGENT_SAFETY_JUDGE_MODEL: fast,
    AGENT_MEMORY_AUTOLINK_MODEL: fast,
    AGENT_MEMORY_CONSOLIDATE_MODEL: fast,
  };
  if (opts.baseURL !== undefined) patch.AGENT_API_BASE_URL = opts.baseURL;
  if (opts.providerOrder !== undefined) patch.AGENT_PROVIDER_ORDER = opts.providerOrder;
  if (opts.providerOrderFast !== undefined) patch.AGENT_PROVIDER_ORDER_FAST = opts.providerOrderFast;
  if (opts.providerRouteAuto !== undefined) patch.AGENT_PROVIDER_ROUTE_AUTO = opts.providerRouteAuto;
  if (opts.allowFallbacks !== undefined) patch.AGENT_PROVIDER_ALLOW_FALLBACKS = opts.allowFallbacks;
  return patch;
}

const DEEPSEEK_V4_PATCH = buildHarnessModelPackEnvPatch({
  main: OPENROUTER_MODEL_SLUG.DEEPSEEK_V4_PRO,
  fast: OPENROUTER_MODEL_SLUG.DEEPSEEK_V4_FLASH,
  baseURL: DEFAULT_AGENT_API_BASE_URL,
  providerOrder: "DeepInfra",
  providerOrderFast: "DeepInfra",
  providerRouteAuto: "0",
  allowFallbacks: "0",
});

const MIMO_V25_PATCH = buildHarnessModelPackEnvPatch({
  main: OPENROUTER_MODEL_SLUG.MIMO_V25_PRO,
  fast: OPENROUTER_MODEL_SLUG.MIMO_V25,
  baseURL: DEFAULT_AGENT_API_BASE_URL,
  providerOrder: "",
  providerOrderFast: "",
  providerRouteAuto: "1",
  allowFallbacks: "1",
});

/** Cloud model packs for OpenRouter (Settings → preset dropdown). */
export const PROVIDER_MODEL_PRESETS: readonly ProviderModelPreset[] = [
  {
    id: "deepseek-v4",
    label: "DeepSeek V4 — Pro + Flash",
    hint:
      "Main: deepseek-v4-pro (agent loop). Fast: deepseek-v4-flash (intent, reflexion, memory sidecars). " +
      "Pinned to DeepInfra for prompt-cache affinity. Requires OpenRouter key in `.env`.",
    baseURL: DEFAULT_AGENT_API_BASE_URL,
    model: OPENROUTER_MODEL_SLUG.DEEPSEEK_V4_PRO,
    harnessEnvPatch: DEEPSEEK_V4_PATCH,
  },
  {
    id: "mimo-v2.5",
    label: "Xiaomi MiMo V2.5 — Pro + standard",
    hint:
      "Main: mimo-v2.5-pro (1M context, agentic). Fast: mimo-v2.5 (~half inference cost). " +
      "Provider routing auto (no DeepInfra pin). Requires OpenRouter key in `.env`.",
    baseURL: DEFAULT_AGENT_API_BASE_URL,
    model: OPENROUTER_MODEL_SLUG.MIMO_V25_PRO,
    harnessEnvPatch: MIMO_V25_PATCH,
  },
] as const;

export function findProviderModelPreset(id: string): ProviderModelPreset | undefined {
  return PROVIDER_MODEL_PRESETS.find((p) => p.id === id);
}

/** Match saved provider + main model to a preset id (for Settings dropdown). */
export function resolveProviderModelPresetId(model: string, baseURL: string): string | null {
  const m = model.trim();
  const b = baseURL.trim().replace(/\/+$/, "");
  for (const p of PROVIDER_MODEL_PRESETS) {
    if (p.model === m && p.baseURL.replace(/\/+$/, "") === b) return p.id;
  }
  return null;
}

/** Defaults when no preset is selected — mirrors product defaults. */
export const DEFAULT_MODEL_PACK = {
  main: DEFAULT_AGENT_MODEL_SLUG,
  fast: DEFAULT_AGENT_FAST_MODEL_SLUG,
} as const;
