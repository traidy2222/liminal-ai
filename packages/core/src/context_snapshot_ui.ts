import type OpenAI from "openai";
import type { ContextManager } from "./context.js";
import type { ContextPolicyTier } from "./context_policy.js";
import type { ContextSnapshot } from "./types.js";
import { estimateRequestTokens, estimateToolsTokens } from "./token_estimate.js";

export function enrichContextSnapshot(
  base: ContextSnapshot,
  opts: {
    context: ContextManager;
    tools?: OpenAI.Chat.Completions.ChatCompletionTool[];
    modelSlug?: string;
  }
): ContextSnapshot {
  const tools = opts.tools ?? [];
  const messages = opts.context.buildMessagesSync();
  const toolTokenCount = tools.length > 0 ? estimateToolsTokens(tools) : 0;
  const requestTokenCount = estimateRequestTokens(
    messages,
    tools.length > 0 ? tools : undefined
  );
  const policy = opts.context.getActiveContextPolicy();
  const maxTokens = base.maxTokens;
  const requestUsageFraction =
    maxTokens > 0 ? Math.min(1, requestTokenCount / maxTokens) : base.usageFraction;

  return {
    ...base,
    ...(opts.tools !== undefined ? { toolTokenCount } : {}),
    requestTokenCount,
    requestUsageFraction,
    ...(policy ? { contextTier: policy.tier as ContextPolicyTier } : {}),
    ...(opts.modelSlug ? { modelSlug: opts.modelSlug } : {}),
  };
}
