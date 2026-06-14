/**
 * OpenRouter Fusion — multi-model deliberation router (`openrouter/fusion`).
 *
 * @see https://openrouter.ai/docs/guides/features/plugins/fusion
 * @see https://openrouter.ai/docs/guides/routing/routers/fusion-router
 */

import { effectiveHarnessEnvRaw } from "./harness_effective_env.js";
import { isOpenRouterApiBaseUrl } from "./openrouter_session.js";

/** OpenRouter Fusion router slug (128K ctx on OpenRouter, Jun 2026). */
export const OPENROUTER_FUSION_MODEL_SLUG = "openrouter/fusion";

export type OpenRouterFusionPreset = "quality" | "budget" | "custom";

/** Plugin payload on chat completion requests (`plugins` array). */
export interface OpenRouterFusionPlugin {
  id: "fusion";
  analysis_models: string[];
  model?: string;
  max_tool_calls?: number;
  enabled?: boolean;
}

/** Concrete slugs — OpenRouter's default `~*-latest` aliases 500 upstream; 2-model panels tested more reliably than 3. */
export const OPENROUTER_FUSION_QUALITY_PANEL: readonly string[] = [
  "anthropic/claude-opus-4.8",
  "openai/gpt-5.5",
] as const;

export const OPENROUTER_FUSION_BUDGET_PANEL: readonly string[] = [
  "deepseek/deepseek-v4-flash",
  "google/gemini-3.1-flash-lite",
] as const;

const FUSION_JUDGE_QUALITY_DEFAULT = "anthropic/claude-opus-4.8";
const FUSION_JUDGE_BUDGET_DEFAULT = "deepseek/deepseek-v4-pro";

const OPENROUTER_ROUTER_SLUGS = new Set<string>([
  OPENROUTER_FUSION_MODEL_SLUG,
  "openrouter/free",
  "openrouter/auto",
]);

export function isOpenRouterFusionModel(modelSlug: string): boolean {
  return modelSlug.trim().toLowerCase() === OPENROUTER_FUSION_MODEL_SLUG;
}

/** Meta-routers on OpenRouter — omit `provider` routing (OpenRouter handles upstream). */
export function isOpenRouterRouterModel(modelSlug: string): boolean {
  return OPENROUTER_ROUTER_SLUGS.has(modelSlug.trim().toLowerCase());
}

export function resolveOpenRouterFusionPreset(): OpenRouterFusionPreset {
  const raw = effectiveHarnessEnvRaw("AGENT_OPENROUTER_FUSION_PRESET")?.trim().toLowerCase();
  if (raw === "budget" || raw === "custom") return raw;
  return "quality";
}

function parseCsvModels(raw: string | undefined | null): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 8);
}

function resolveFusionMaxToolCalls(): number {
  const raw = parseInt(effectiveHarnessEnvRaw("AGENT_OPENROUTER_FUSION_MAX_TOOL_CALLS") ?? "4", 10);
  if (!Number.isFinite(raw)) return 4;
  return Math.max(1, Math.min(16, raw));
}

function resolveFusionJudgeModel(preset: OpenRouterFusionPreset, panel: string[]): string {
  const override = effectiveHarnessEnvRaw("AGENT_OPENROUTER_FUSION_JUDGE")?.trim();
  if (override) return override;
  if (preset === "budget") {
    return FUSION_JUDGE_BUDGET_DEFAULT;
  }
  return panel[0] ?? FUSION_JUDGE_QUALITY_DEFAULT;
}

function resolveFusionPanel(preset: OpenRouterFusionPreset): string[] {
  if (preset === "custom") {
    const custom = parseCsvModels(effectiveHarnessEnvRaw("AGENT_OPENROUTER_FUSION_ANALYSIS_MODELS"));
    if (custom.length > 0) return custom;
    return [...OPENROUTER_FUSION_QUALITY_PANEL];
  }
  if (preset === "budget") return [...OPENROUTER_FUSION_BUDGET_PANEL];
  return [...OPENROUTER_FUSION_QUALITY_PANEL];
}

/**
 * Build the Fusion plugin block. Always sent for `openrouter/fusion` so we do not
 * rely on OpenRouter's default Quality `~*-latest` aliases (can fail upstream).
 */
export function buildOpenRouterFusionPlugin(
  opts: { preset?: OpenRouterFusionPreset } = {}
): OpenRouterFusionPlugin {
  const preset = opts.preset ?? resolveOpenRouterFusionPreset();
  const analysis_models = resolveFusionPanel(preset);
  const plugin: OpenRouterFusionPlugin = {
    id: "fusion",
    analysis_models,
    model: resolveFusionJudgeModel(preset, analysis_models),
    max_tool_calls: resolveFusionMaxToolCalls(),
  };
  return plugin;
}

export type OpenRouterFusionRequestExtras = {
  plugins: OpenRouterFusionPlugin[];
};

/**
 * Attach Fusion plugin config when the active model is `openrouter/fusion`.
 * Returns {} for other models / non-OpenRouter bases.
 */
export function buildOpenRouterFusionRequestExtras(opts: {
  baseURL: string;
  modelSlug: string;
}): OpenRouterFusionRequestExtras | Record<string, never> {
  if (!isOpenRouterApiBaseUrl(opts.baseURL)) return {};
  if (!isOpenRouterFusionModel(opts.modelSlug)) return {};
  return { plugins: [buildOpenRouterFusionPlugin()] };
}
