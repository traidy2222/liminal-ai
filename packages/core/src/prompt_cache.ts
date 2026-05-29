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
 *
 * A second, optional *rolling* breakpoint (AGENT_PROMPT_CACHE_ROLLING, default
 * on) is placed on the last stable conversation message so the cache extends
 * across the growing tool-result history — not just the ~14k static prefix —
 * which is the dominant token cost in long ReAct turns. Up to 2 breakpoints,
 * well under the 4-breakpoint provider limit.
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
 * Returns true when the rolling second breakpoint (over conversation history)
 * should be added in addition to the static-prefix breakpoint. Default on.
 */
function isRollingCacheEnabled(): boolean {
  const raw = effectiveHarnessEnvRaw("AGENT_PROMPT_CACHE_ROLLING")?.trim();
  if (raw === undefined || raw === "") return true;
  return raw !== "0" && raw.toLowerCase() !== "false";
}

/**
 * Wrap a string-content message's body in a single text part carrying an
 * ephemeral cache_control breakpoint. Returns null when the message can't be
 * wrapped (non-string or empty content — e.g. multimodal parts arrays).
 */
function wrapWithCacheControl(m: Message): Message | null {
  if (typeof m.content !== "string" || m.content.length === 0) return null;
  return {
    ...m,
    content: [
      {
        type: "text",
        text: m.content,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        cache_control: { type: "ephemeral" },
      } as unknown as { type: "text"; text: string },
    ],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
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

  // Breakpoint #1 — static prefix (persona + protocol + named rules + suffix).
  const wrappedPrefix = wrapWithCacheControl(target);
  if (!wrappedPrefix) return messages; // multimodal/empty prefix — skip entirely.

  const out = messages.slice();
  out[lastStaticIdx] = wrappedPrefix;

  // Breakpoint #2 — rolling, over the conversation history. Place it on the last
  // *stable* message: walk back over the trailing run of volatile working /
  // execution-state system blocks (which are recomputed every round and live at
  // the tail when AGENT_CTX_VOLATILE_TAIL is on), then tag the message before
  // them. That message is byte-identical next round (history only appends), so
  // round N+1 reads the whole [prefix … round-N tail] span from cache instead of
  // re-billing the accumulated tool-result history cold.
  if (isRollingCacheEnabled()) {
    let rollingIdx = messages.length - 1;
    while (rollingIdx > lastStaticIdx) {
      const m = messages[rollingIdx];
      if (
        m &&
        m.role === "system" &&
        typeof m.content === "string" &&
        /^\[(WORKING STATE|EXECUTION STATE)/.test(m.content)
      ) {
        rollingIdx -= 1;
        continue;
      }
      break;
    }
    // Only add a distinct second breakpoint when there's real history past the
    // static prefix and the target is wrappable (plain string content).
    if (rollingIdx > lastStaticIdx) {
      const rollingTarget = messages[rollingIdx];
      const wrappedRolling = rollingTarget ? wrapWithCacheControl(rollingTarget) : null;
      if (wrappedRolling) out[rollingIdx] = wrappedRolling;
    }
  }

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
