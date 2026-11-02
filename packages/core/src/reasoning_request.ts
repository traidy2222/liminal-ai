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
  // Match known hybrid families, not dedicated thinking variants such as
  // v3.2-speciale or :thinking. Unknown variants retain their provider default.
  const hybridDeepSeek = /^deepseek\/(?:deepseek-v(?:3\.[12](?:-\d{4,8})?|4(?:\.\d+)?-(?:flash|pro)(?:-\d{4,8})?)|deepseek-(?:chat|flash))(?::(?:free|nitro|floor))?$/i.test(opts.modelSlug.trim());
  if (opts.surface === "external" && hybridDeepSeek && supportsOpenRouterRequestExtras(opts.baseURL)) {
    return { reasoning: { enabled: false } };
  }
  return opts.budget ? buildOpenRouterReasoningParam(opts.budget, opts.surface) : {};
}
