import { supportsOpenRouterRequestExtras } from "./openrouter_session.js";
import { buildOpenRouterReasoningParam, type ReasoningBudget } from "./reasoning_profile.js";
import type { ReasoningSurface } from "./reasoning_surface.js";

/** DeepSeek's hybrid models default to native thinking when the field is omitted.
 * External reasoning is implemented by Liminal's think/reason tools instead.
 * Keep mandatory-reasoning models and other compatible APIs unchanged.
 */
export function buildReasoningRequestParams(opts: {
  baseURL: string;
  modelSlug: string;
  surface: ReasoningSurface;
  budget?: ReasoningBudget | null;
}): { reasoning?: { enabled?: boolean; effort?: string; max_tokens?: number } } {
  const hybridDeepSeek = /^deepseek\/(?:deepseek-v(?:3\.[12]|4(?:[.\-/]|$))|deepseek-(?:chat|flash)(?:[:/\-]|$))/i.test(opts.modelSlug);
  if (opts.surface === "external" && hybridDeepSeek && supportsOpenRouterRequestExtras(opts.baseURL)) {
    return { reasoning: { enabled: false } };
  }
  return opts.budget ? buildOpenRouterReasoningParam(opts.budget, opts.surface) : {};
}
