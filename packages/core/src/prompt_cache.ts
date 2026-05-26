/**
 * OpenRouter prompt-cache breakpoints.
 *
 * Every ReAct round resends the same static prefix (persona + PROTOCOL_CORE +
 * named rules + dynamic suffix). On cache-supporting providers (DeepInfra,
 * GMICloud, NovitaAI, …), tagging the trailing static system message with
 * `cache_control: { type: "ephemeral" }` lets the provider serve cached input
 * tokens at ~1/10× the normal rate. The helper is a no-op when the input has
 * no system messages or when caching is disabled by env.
 *
 * Spec: https://openrouter.ai/docs/features/prompt-caching
 * The `content` field is widened from `string` → `[{ type: "text", text,
 * cache_control }]` only on the *last* contiguous system message — the inception
 * block — so dynamic per-turn system notes (rule recalls, world context deltas)
 * appended later don't accidentally invalidate the cache.
 */

import type { Message } from "./types.js";
import { effectiveHarnessEnvRaw } from "./harness_effective_env.js";

/** Returns true when prompt caching breakpoints should be added to requests. */
export function isPromptCacheEnabled(): boolean {
  const raw = effectiveHarnessEnvRaw("AGENT_PROMPT_CACHE")?.trim();
  // Default on; only "0" / "false" disables.
  if (raw === undefined || raw === "") return true;
  return raw !== "0" && raw.toLowerCase() !== "false";
}

/**
 * Returns a new messages array with a cache_control breakpoint on the final
 * message of the leading static system block. The leading block is defined as
 * the contiguous run of `role: "system"` (and `role: "user"` with prefix
 * "[SUBTASK CONTEXT]") messages at the start of the conversation, before any
 * assistant or non-prefix user message.
 *
 * If caching is disabled, returns the input unchanged (same reference).
 */
export function applyPromptCacheBreakpoints(messages: Message[]): Message[] {
  if (!isPromptCacheEnabled()) return messages;
  if (messages.length === 0) return messages;

  // Find the last index of the leading static system block.
  let lastStaticIdx = -1;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (!m) break;
    if (m.role === "system") {
      lastStaticIdx = i;
      continue;
    }
    // Allow [SUBTASK CONTEXT] / [SPAWN] prelude user messages to count as part
    // of inception so the cache breakpoint lands after them.
    if (
      m.role === "user" &&
      typeof m.content === "string" &&
      /^\[(SUBTASK CONTEXT|SPAWN|EXECUTION CONTRACT)/.test(m.content)
    ) {
      lastStaticIdx = i;
      continue;
    }
    break;
  }

  if (lastStaticIdx < 0) return messages;

  const target = messages[lastStaticIdx];
  if (!target) return messages;

  // Already a parts array (e.g. multimodal user msg) — skip, don't double-wrap.
  if (typeof target.content !== "string") return messages;
  if (target.content.length === 0) return messages;

  const wrapped: Message = {
    ...target,
    // OpenRouter / OpenAI-compatible message shape: content as parts array.
    // `cache_control` is an extra field the SDK forwards verbatim.
    content: [
      {
        type: "text",
        text: target.content,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        cache_control: { type: "ephemeral" },
      } as unknown as { type: "text"; text: string },
    ],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  const out = messages.slice();
  out[lastStaticIdx] = wrapped;
  return out;
}

/**
 * Extracts the cached-input-tokens count from a provider's `usage` payload, if
 * any. OpenRouter normalizes to `prompt_tokens_details.cached_tokens` on
 * providers that support it. Returns 0 when absent.
 */
export function extractCachedTokens(usage: unknown): number {
  if (!usage || typeof usage !== "object") return 0;
  const u = usage as {
    prompt_tokens_details?: { cached_tokens?: number };
    cached_tokens?: number;
    cache_read_input_tokens?: number;
  };
  const v =
    u.prompt_tokens_details?.cached_tokens ??
    u.cached_tokens ??
    u.cache_read_input_tokens ??
    0;
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
