/**
 * OpenRouter model packs — one-click switch for main + fast + sidecar model slots.
 * Consumed by web Settings and setup scripts (browser imports via package export).
 *
 * Slugs verified against GET https://openrouter.ai/api/v1/models (May 2026).
 */
import {
  DEFAULT_AGENT_API_BASE_URL,
  DEFAULT_AGENT_FAST_MODEL_SLUG,
  DEFAULT_AGENT_MODEL_SLUG,
} from "./harness_default_constants.js";

/** OpenRouter slugs (see https://openrouter.ai/models). */
export const OPENROUTER_MODEL_SLUG = {
  // DeepSeek / Xiaomi (product defaults)
  DEEPSEEK_V4_PRO: "deepseek/deepseek-v4-pro",
  DEEPSEEK_V4_FLASH: "deepseek/deepseek-v4-flash",
  MIMO_V25_PRO: "xiaomi/mimo-v2.5-pro",
  MIMO_V25: "xiaomi/mimo-v2.5",
  // Anthropic
  CLAUDE_OPUS_47: "anthropic/claude-opus-4.7",
  CLAUDE_OPUS_47_FAST: "anthropic/claude-opus-4.7-fast",
  CLAUDE_SONNET_46: "anthropic/claude-sonnet-4.6",
  CLAUDE_HAIKU_45: "anthropic/claude-haiku-4.5",
  // Google
  GEMINI_35_FLASH: "google/gemini-3.5-flash",
  GEMINI_31_FLASH_LITE: "google/gemini-3.1-flash-lite",
  // OpenAI
  GPT_55: "openai/gpt-5.5",
  GPT_54_MINI: "openai/gpt-5.4-mini",
  // Meta
  LLAMA4_MAVERICK: "meta-llama/llama-4-maverick",
  LLAMA4_SCOUT: "meta-llama/llama-4-scout",
  // Qwen
  QWEN36_PLUS: "qwen/qwen3.6-plus",
  QWEN36_FLASH: "qwen/qwen3.6-flash",
  QWEN3_CODER_PLUS: "qwen/qwen3-coder-plus",
  QWEN3_CODER_FLASH: "qwen/qwen3-coder-flash",
  // Moonshot / Z.ai
  KIMI_K26: "moonshotai/kimi-k2.6",
  KIMI_K25: "moonshotai/kimi-k2.5",
  GLM_47: "z-ai/glm-4.7",
  GLM_47_FLASH: "z-ai/glm-4.7-flash",
  // OpenRouter Stealth (Hermes / owl line)
  OWL_ALPHA: "openrouter/owl-alpha",
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
  providerStrategy?: string;
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
  if (opts.providerStrategy !== undefined) patch.AGENT_PROVIDER_STRATEGY = opts.providerStrategy;
  if (opts.providerOrder !== undefined) patch.AGENT_PROVIDER_ORDER = opts.providerOrder;
  if (opts.providerOrderFast !== undefined) patch.AGENT_PROVIDER_ORDER_FAST = opts.providerOrderFast;
  if (opts.providerRouteAuto !== undefined) patch.AGENT_PROVIDER_ROUTE_AUTO = opts.providerRouteAuto;
  if (opts.allowFallbacks !== undefined) patch.AGENT_PROVIDER_ALLOW_FALLBACKS = opts.allowFallbacks;
  return patch;
}

/** Price-sorted OpenRouter routing — live benchmark best bang-for-buck on DeepSeek V4 Pro. */
function deepseekV4PricePatch(): Record<string, string> {
  return buildHarnessModelPackEnvPatch({
    main: OPENROUTER_MODEL_SLUG.DEEPSEEK_V4_PRO,
    fast: OPENROUTER_MODEL_SLUG.DEEPSEEK_V4_FLASH,
    baseURL: DEFAULT_AGENT_API_BASE_URL,
    providerStrategy: "price",
    providerOrder: "",
    providerOrderFast: "",
    providerRouteAuto: "1",
    allowFallbacks: "1",
  });
}

/** Adaptive routing — price sort + session epoch bump on upstream 429. */
function deepseekV4AdaptivePatch(): Record<string, string> {
  return buildHarnessModelPackEnvPatch({
    main: OPENROUTER_MODEL_SLUG.DEEPSEEK_V4_PRO,
    fast: OPENROUTER_MODEL_SLUG.DEEPSEEK_V4_FLASH,
    baseURL: DEFAULT_AGENT_API_BASE_URL,
    providerStrategy: "adaptive",
    providerOrder: "",
    providerOrderFast: "",
    providerRouteAuto: "1",
    allowFallbacks: "1",
  });
}

/** DeepInfra pin — explicit cache-first routing for DeepSeek V4 on OpenRouter. */
function deepseekV4PinPatch(): Record<string, string> {
  return buildHarnessModelPackEnvPatch({
    main: OPENROUTER_MODEL_SLUG.DEEPSEEK_V4_PRO,
    fast: OPENROUTER_MODEL_SLUG.DEEPSEEK_V4_FLASH,
    baseURL: DEFAULT_AGENT_API_BASE_URL,
    providerStrategy: "cache_first",
    providerOrder: "DeepInfra",
    providerOrderFast: "DeepInfra",
    providerRouteAuto: "0",
    allowFallbacks: "0",
  });
}

/** Stealth provider pin — required for openrouter/owl-alpha (404 if pinned to DeepInfra/DeepSeek). */
function owlStealthPinPatch(): Record<string, string> {
  return buildHarnessModelPackEnvPatch({
    main: OPENROUTER_MODEL_SLUG.OWL_ALPHA,
    fast: OPENROUTER_MODEL_SLUG.OWL_ALPHA,
    baseURL: DEFAULT_AGENT_API_BASE_URL,
    providerStrategy: "cache_first",
    providerOrder: "Stealth",
    providerOrderFast: "Stealth",
    providerRouteAuto: "0",
    allowFallbacks: "0",
  });
}

/** Same-vendor or cross-vendor pack with OpenRouter auto routing + fallbacks. */
function openRouterAutoRoutePatch(main: string, fast: string): Record<string, string> {
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

function preset(
  id: string,
  label: string,
  hint: string,
  main: string,
  harnessEnvPatch: Record<string, string>
): ProviderModelPreset {
  return {
    id,
    label,
    hint,
    baseURL: DEFAULT_AGENT_API_BASE_URL,
    model: main,
    harnessEnvPatch,
  };
}

/** Cloud model packs for OpenRouter (Settings → preset dropdown). */
export const PROVIDER_MODEL_PRESETS: readonly ProviderModelPreset[] = [
  // —— Same developer (main + fast tier) ——
  preset(
    "deepseek-v4",
    "DeepSeek V4 — Pro + Flash (Price)",
    "Latest DeepSeek pair on OpenRouter (Apr 2026). Main: v4-pro (~$0.44/M in). Fast: v4-flash (~$0.10/M in). " +
      "Price routing: OpenRouter sort=price + session stickiness (benchmark default for cost + cache).",
    OPENROUTER_MODEL_SLUG.DEEPSEEK_V4_PRO,
    deepseekV4PricePatch()
  ),
  preset(
    "deepseek-v4-adaptive",
    "DeepSeek V4 — Pro + Flash (Adaptive)",
    "Same DeepSeek V4 pair with adaptive routing (price sort + session epoch bump on upstream 429).",
    OPENROUTER_MODEL_SLUG.DEEPSEEK_V4_PRO,
    deepseekV4AdaptivePatch()
  ),
  preset(
    "deepseek-v4-deepinfra-pin",
    "DeepSeek V4 — Pro + Flash (DeepInfra pin)",
    "Same DeepSeek V4 pair with explicit DeepInfra cache-first pin (legacy behavior). " +
      "Use when you want a fixed reseller instead of live price routing.",
    OPENROUTER_MODEL_SLUG.DEEPSEEK_V4_PRO,
    deepseekV4PinPatch()
  ),
  preset(
    "openrouter-owl-stealth",
    "Owl Alpha — Stealth (single model)",
    "Free Stealth owl-alpha for the main ReAct loop and all sidecars — no separate fast tier. " +
      "Must pin to Stealth provider (DeepInfra/DeepSeek pins return HTTP 404 for this slug). " +
      "Note: prompts and completions may be logged by the provider and used to improve the model.",
    OPENROUTER_MODEL_SLUG.OWL_ALPHA,
    owlStealthPinPatch()
  ),
  preset(
    "mix-owl-stealth-deepseek-flash",
    "Mix — Owl Alpha (Stealth) + DeepSeek Flash",
    "Stealth owl-alpha main ReAct loop + DeepSeek v4-flash sidecars (intent, memory JSON). " +
      "Main pinned to Stealth; fast tier uses OpenRouter auto-route.",
    OPENROUTER_MODEL_SLUG.OWL_ALPHA,
    buildHarnessModelPackEnvPatch({
      main: OPENROUTER_MODEL_SLUG.OWL_ALPHA,
      fast: OPENROUTER_MODEL_SLUG.DEEPSEEK_V4_FLASH,
      baseURL: DEFAULT_AGENT_API_BASE_URL,
      providerStrategy: "cache_first",
      providerOrder: "Stealth",
      providerOrderFast: "DeepInfra",
      providerRouteAuto: "0",
      allowFallbacks: "0",
    })
  ),
  preset(
    "mimo-v2.5",
    "Xiaomi MiMo V2.5 — Pro + standard",
    "Latest MiMo line. Main: mimo-v2.5-pro (1M ctx). Fast: mimo-v2.5 (~3× cheaper). OpenRouter auto-routes providers.",
    OPENROUTER_MODEL_SLUG.MIMO_V25_PRO,
    openRouterAutoRoutePatch(OPENROUTER_MODEL_SLUG.MIMO_V25_PRO, OPENROUTER_MODEL_SLUG.MIMO_V25)
  ),
  preset(
    "google-gemini-3.5",
    "Google Gemini 3.5 — Flash + 3.1 Flash Lite",
    "Latest stable Google slugs (May 2026). Main: gemini-3.5-flash (1M). Fast: gemini-3.1-flash-lite (~6× cheaper). " +
      "Replaces deprecated Gemini 2.5 / 3.1-preview packs.",
    OPENROUTER_MODEL_SLUG.GEMINI_35_FLASH,
    openRouterAutoRoutePatch(OPENROUTER_MODEL_SLUG.GEMINI_35_FLASH, OPENROUTER_MODEL_SLUG.GEMINI_31_FLASH_LITE)
  ),
  preset(
    "anthropic-claude-opus-4.7",
    "Anthropic Claude Opus 4.7 + Opus Fast",
    "Frontier Anthropic line (Apr 2026). Main: claude-opus-4.7 (1M). Fast: claude-opus-4.7-fast. " +
      "No Sonnet 4.7 on OpenRouter yet — use Sonnet 4.6 pack for balanced cost.",
    OPENROUTER_MODEL_SLUG.CLAUDE_OPUS_47,
    openRouterAutoRoutePatch(OPENROUTER_MODEL_SLUG.CLAUDE_OPUS_47, OPENROUTER_MODEL_SLUG.CLAUDE_OPUS_47_FAST)
  ),
  preset(
    "anthropic-claude-sonnet-4.6",
    "Anthropic Claude Sonnet 4.6 + Haiku 4.5",
    "Best Sonnet-tier pair on OpenRouter. Main: claude-sonnet-4.6 (1M, ~$3/$15 per M). Fast: claude-haiku-4.5.",
    OPENROUTER_MODEL_SLUG.CLAUDE_SONNET_46,
    openRouterAutoRoutePatch(OPENROUTER_MODEL_SLUG.CLAUDE_SONNET_46, OPENROUTER_MODEL_SLUG.CLAUDE_HAIKU_45)
  ),
  preset(
    "openai-gpt-5.5",
    "OpenAI GPT-5.5 + GPT-5.4 mini",
    "Latest OpenAI chat pair (May 2026). Main: gpt-5.5 (1M+). Fast: gpt-5.4-mini (no gpt-5.5-mini slug).",
    OPENROUTER_MODEL_SLUG.GPT_55,
    openRouterAutoRoutePatch(OPENROUTER_MODEL_SLUG.GPT_55, OPENROUTER_MODEL_SLUG.GPT_54_MINI)
  ),
  preset(
    "meta-llama-4",
    "Meta Llama 4 — Maverick + Scout",
    "Latest Llama 4 open-weight pair. Main: llama-4-maverick (1M). Fast: llama-4-scout (10M ctx, very cheap).",
    OPENROUTER_MODEL_SLUG.LLAMA4_MAVERICK,
    openRouterAutoRoutePatch(OPENROUTER_MODEL_SLUG.LLAMA4_MAVERICK, OPENROUTER_MODEL_SLUG.LLAMA4_SCOUT)
  ),
  preset(
    "qwen-3.6",
    "Qwen 3.6 — Plus + Flash",
    "Latest Qwen agent pair (May 2026). Main: qwen3.6-plus (1M). Fast: qwen3.6-flash. Replaces Qwen 3.5 Plus pack.",
    OPENROUTER_MODEL_SLUG.QWEN36_PLUS,
    openRouterAutoRoutePatch(OPENROUTER_MODEL_SLUG.QWEN36_PLUS, OPENROUTER_MODEL_SLUG.QWEN36_FLASH)
  ),
  preset(
    "qwen-coder",
    "Qwen — Coder Plus + Coder Flash",
    "Latest Qwen coding pair. Main: qwen3-coder-plus (1M). Fast: qwen3-coder-flash. Replaces qwen3-coder + 3.5-9b.",
    OPENROUTER_MODEL_SLUG.QWEN3_CODER_PLUS,
    openRouterAutoRoutePatch(OPENROUTER_MODEL_SLUG.QWEN3_CODER_PLUS, OPENROUTER_MODEL_SLUG.QWEN3_CODER_FLASH)
  ),
  preset(
    "kimi-k2",
    "Moonshot Kimi — K2.6 + K2.5",
    "Latest Kimi pair. Main: kimi-k2.6. Fast: kimi-k2.5. Strong CN/EN agentic work.",
    OPENROUTER_MODEL_SLUG.KIMI_K26,
    openRouterAutoRoutePatch(OPENROUTER_MODEL_SLUG.KIMI_K26, OPENROUTER_MODEL_SLUG.KIMI_K25)
  ),
  preset(
    "zai-glm-4.7",
    "Z.ai GLM — 4.7 + 4.7 Flash",
    "Latest GLM pair. Main: glm-4.7. Fast: glm-4.7-flash.",
    OPENROUTER_MODEL_SLUG.GLM_47,
    openRouterAutoRoutePatch(OPENROUTER_MODEL_SLUG.GLM_47, OPENROUTER_MODEL_SLUG.GLM_47_FLASH)
  ),
  // —— Cross-developer (mixed main + fast) ——
  preset(
    "mix-claude-opus-4.7-deepseek-flash",
    "Mix — Claude Opus 4.7 + DeepSeek Flash",
    "Frontier Anthropic main + cheapest DeepSeek sidecars for intent/memory/safety JSON.",
    OPENROUTER_MODEL_SLUG.CLAUDE_OPUS_47,
    openRouterAutoRoutePatch(OPENROUTER_MODEL_SLUG.CLAUDE_OPUS_47, OPENROUTER_MODEL_SLUG.DEEPSEEK_V4_FLASH)
  ),
  preset(
    "mix-claude-sonnet-4.6-deepseek-flash",
    "Mix — Claude Sonnet 4.6 + DeepSeek Flash",
    "Balanced Anthropic main (Sonnet 4.6) + DeepSeek Flash sidecars — best quality/$ for long harness runs.",
    OPENROUTER_MODEL_SLUG.CLAUDE_SONNET_46,
    openRouterAutoRoutePatch(OPENROUTER_MODEL_SLUG.CLAUDE_SONNET_46, OPENROUTER_MODEL_SLUG.DEEPSEEK_V4_FLASH)
  ),
  preset(
    "mix-gemini-3.5-deepseek-flash",
    "Mix — Gemini 3.5 Flash + DeepSeek Flash",
    "Latest Google main (1M multimodal) + DeepSeek Flash sidecars. Good for web/research at moderate cost.",
    OPENROUTER_MODEL_SLUG.GEMINI_35_FLASH,
    openRouterAutoRoutePatch(OPENROUTER_MODEL_SLUG.GEMINI_35_FLASH, OPENROUTER_MODEL_SLUG.DEEPSEEK_V4_FLASH)
  ),
  preset(
    "mix-deepseek-haiku",
    "Mix — DeepSeek V4 Pro + Claude Haiku 4.5",
    "Cheap capable main (DeepInfra pin) + latest Anthropic Haiku for crisp JSON sidecars.",
    OPENROUTER_MODEL_SLUG.DEEPSEEK_V4_PRO,
    buildHarnessModelPackEnvPatch({
      main: OPENROUTER_MODEL_SLUG.DEEPSEEK_V4_PRO,
      fast: OPENROUTER_MODEL_SLUG.CLAUDE_HAIKU_45,
      baseURL: DEFAULT_AGENT_API_BASE_URL,
      providerOrder: "DeepInfra",
      providerOrderFast: "",
      providerRouteAuto: "0",
      allowFallbacks: "0",
    })
  ),
  preset(
    "mix-gpt55-gemini-flash-lite",
    "Mix — GPT-5.5 + Gemini 3.1 Flash Lite",
    "OpenAI main (tool-heavy) + latest cheap Google fast tier (gemini-3.1-flash-lite).",
    OPENROUTER_MODEL_SLUG.GPT_55,
    openRouterAutoRoutePatch(OPENROUTER_MODEL_SLUG.GPT_55, OPENROUTER_MODEL_SLUG.GEMINI_31_FLASH_LITE)
  ),
  preset(
    "mix-qwen-coder-deepseek-flash",
    "Mix — Qwen3 Coder Plus + DeepSeek Flash",
    "Latest code-specialist main + ultra-cheap DeepSeek sidecars.",
    OPENROUTER_MODEL_SLUG.QWEN3_CODER_PLUS,
    openRouterAutoRoutePatch(OPENROUTER_MODEL_SLUG.QWEN3_CODER_PLUS, OPENROUTER_MODEL_SLUG.DEEPSEEK_V4_FLASH)
  ),
] as const;

export function findProviderModelPreset(id: string): ProviderModelPreset | undefined {
  return PROVIDER_MODEL_PRESETS.find((p) => p.id === id);
}

/** Match saved provider + main model to a preset id (for Settings dropdown). */
export function resolveProviderModelPresetId(model: string, baseURL: string): string | null {
  const m = model.trim();
  const b = normalizeProviderBaseUrl(baseURL);
  for (const p of PROVIDER_MODEL_PRESETS) {
    if (p.model === m && normalizeProviderBaseUrl(p.baseURL) === b) return p.id;
  }
  return null;
}

export const PROVIDER_PRESET_CUSTOM_ID = "custom";

/** Wire shape for Settings UIs (web + desktop). */
export interface ProviderPresetWire {
  id: string;
  label: string;
  hint: string;
  baseURL: string;
  model: string;
  harnessEnvPatch?: Record<string, string>;
}

export function normalizeProviderBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/** Full preset list for Settings provider dropdown (cloud packs + local stacks). */
export function listProviderPresetsForSettings(): readonly ProviderPresetWire[] {
  return [
    {
      id: PROVIDER_PRESET_CUSTOM_ID,
      label: "Custom…",
      hint: "No automatic fill — edit model and base URL below.",
      baseURL: "",
      model: "",
    },
    ...PROVIDER_MODEL_PRESETS.map((p) => ({
      id: p.id,
      label: p.label,
      hint: p.hint,
      baseURL: p.baseURL,
      model: p.model,
      harnessEnvPatch: p.harnessEnvPatch,
    })),
    {
      id: "lmstudio",
      label: "LM Studio (local :1234)",
      hint: "Local OpenAI-compatible server — match the Model ID shown in LM Studio.",
      baseURL: "http://localhost:1234/v1",
      model: DEFAULT_AGENT_MODEL_SLUG,
      harnessEnvPatch: {
        AGENT_API_BASE_URL: "http://localhost:1234/v1",
        AGENT_FAST_MODEL: DEFAULT_AGENT_MODEL_SLUG,
      },
    },
    {
      id: "ollama",
      label: "Ollama (local :11434)",
      hint: "`ollama serve` — typical slug `qwen3.5:9b` (pull via `ollama pull qwen3.5:9b`).",
      baseURL: "http://localhost:11434/v1",
      model: "qwen3.5:9b",
      harnessEnvPatch: { AGENT_FAST_MODEL: "qwen3.5:9b" },
    },
  ];
}

/** Resolve current model + base URL to a preset id (includes local stacks). */
export function resolveProviderPresetId(model: string, baseURL: string): string {
  const cloud = resolveProviderModelPresetId(model, baseURL);
  if (cloud) return cloud;
  const m = model.trim();
  const b = normalizeProviderBaseUrl(baseURL);
  for (const p of listProviderPresetsForSettings()) {
    if (p.id === PROVIDER_PRESET_CUSTOM_ID) continue;
    if (!p.baseURL) continue;
    if (normalizeProviderBaseUrl(p.baseURL) === b && p.model === m) return p.id;
  }
  return PROVIDER_PRESET_CUSTOM_ID;
}

/** Defaults when no preset is selected — mirrors product defaults. */
export const DEFAULT_MODEL_PACK = {
  main: DEFAULT_AGENT_MODEL_SLUG,
  fast: DEFAULT_AGENT_FAST_MODEL_SLUG,
} as const;