/**
 * Small-model routing + JSON chat completions for distill / rewrite / critic.
 */
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";
import { withProviderRequestSpacing } from "./provider_request_gate.js";
import { effectiveHarnessEnvRaw } from "./harness_effective_env.js";
import {
  buildOpenRouterChatRequestExtras,
  resolveProviderStrategy,
  sessionEpochBumpOn429Enabled,
} from "./provider_config.js";
import { applyPromptCacheBreakpoints } from "./prompt_cache.js";
import {
  isExhaustedProviderRoutingError,
  parseOpenRouterProviderSlug,
} from "./openrouter_errors.js";
import { isManagedInferenceBaseUrl } from "./inference_session.js";
import { vireonProxyAlreadyRetriedUpstream } from "./vireon_proxy.js";
import type { ProviderRouteState } from "./provider_route_state.js";
import type { Message } from "./types.js";

export function getFastModelSlug(fallback: string): string {
  const m = effectiveHarnessEnvRaw("AGENT_FAST_MODEL")?.trim();
  return m && m.length > 0 ? m : fallback;
}

export type JsonCompletionResult =
  | { ok: true; parsed: unknown; raw: string }
  | { ok: false; error: string; raw: string };

// ─── In-process JSON response cache ─────────────────────────────────────────────
// Fast-model JSON sidecar calls (intent classify, distill, query rewrite, critic,
// recall rerank) are pure functions of their inputs. Identical inputs recur often
// (retries, re-classifying the same user message, repeated distills). Cache the
// successful parse in a small TTL'd LRU so we skip the round-trip. Only `ok:true`
// results are cached — failures must always retry. Disable with AGENT_LLM_JSON_CACHE=0.

interface JsonCacheEntry {
  raw: string;
  expires: number;
}

const jsonResponseCache = new Map<string, JsonCacheEntry>();

function jsonCacheConfig(): { enabled: boolean; ttlMs: number; max: number } {
  const enabled = effectiveHarnessEnvRaw("AGENT_LLM_JSON_CACHE") !== "0";
  const ttlRaw = Number(effectiveHarnessEnvRaw("AGENT_LLM_JSON_CACHE_TTL_MS") ?? "300000");
  const ttlMs = Number.isFinite(ttlRaw) && ttlRaw > 0 ? ttlRaw : 300_000;
  const maxRaw = Number(effectiveHarnessEnvRaw("AGENT_LLM_JSON_CACHE_MAX") ?? "256");
  const max = Number.isFinite(maxRaw) && maxRaw > 0 ? Math.floor(maxRaw) : 256;
  return { enabled, ttlMs, max };
}

/** FNV-1a 32-bit — compact, dependency-free digest for the cache key. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

function jsonCacheKey(model: string, messages: unknown, temperature: number, maxTokens: number): string {
  const body = JSON.stringify(messages);
  // Length guards against the astronomically-unlikely FNV collision between two
  // different prompts that hash equal; model+temp+tokens pin the semantic request.
  return `${model}|${temperature}|${maxTokens}|${body.length}|${fnv1a(body)}`;
}

function readJsonCache(key: string): JsonCompletionResult | null {
  const hit = jsonResponseCache.get(key);
  if (!hit) return null;
  if (hit.expires <= Date.now()) {
    jsonResponseCache.delete(key);
    return null;
  }
  // Touch for LRU recency.
  jsonResponseCache.delete(key);
  jsonResponseCache.set(key, hit);
  try {
    return { ok: true, parsed: JSON.parse(hit.raw), raw: hit.raw };
  } catch {
    jsonResponseCache.delete(key);
    return null;
  }
}

function writeJsonCache(key: string, raw: string, ttlMs: number, max: number): void {
  jsonResponseCache.set(key, { raw, expires: Date.now() + ttlMs });
  while (jsonResponseCache.size > max) {
    const oldest = jsonResponseCache.keys().next().value;
    if (oldest === undefined) break;
    jsonResponseCache.delete(oldest);
  }
}

/** Test/maintenance hook — clears the in-process JSON response cache. */
export function clearJsonResponseCache(): void {
  jsonResponseCache.clear();
}

function isRateLimitErrorMessage(msg: string): boolean {
  return /429|503|quota|rate.?limit|too many/i.test(msg);
}

/**
 * Non-streaming chat completion expecting JSON in the message body.
 * Uses `json_object` format (widely supported on OpenRouter).
 * When `fallbackModel` is set and the primary call hits 429/503 quota errors,
 * automatically retries with the fallback model and emits a console warning.
 */
export async function completeChatJson(
  client: OpenAI,
  opts: {
    model: string;
    messages: ChatCompletionMessageParam[];
    maxTokens?: number;
    temperature?: number;
    /** When aborted (timeout), the SDK rejects and {@link JsonCompletionResult} reports the error. */
    signal?: AbortSignal;
    /** Stable ID for OpenRouter session grouping (defaults to active chat / userId). */
    sessionId?: string;
    /** @deprecated Prefer sessionId — still honored when sessionId is unset. */
    userId?: string;
    /** Set true for fast/sidecar model calls — uses AGENT_PROVIDER_ORDER_FAST if set. */
    isFastModel?: boolean;
    /** Main model slug to fall back to if the fast model returns 429/503. */
    fallbackModel?: string;
    /** Opt out of the in-process JSON response cache for this call (default: cached). */
    cache?: boolean;
    /** Per-harness route state for adaptive 429 rotation (optional). */
    routeState?: ProviderRouteState;
  }
): Promise<JsonCompletionResult> {
  const cacheCfg = jsonCacheConfig();
  const useCache = cacheCfg.enabled && opts.cache !== false;
  const cacheKey = useCache
    ? jsonCacheKey(
        opts.model,
        opts.messages,
        opts.temperature ?? 0.2,
        opts.maxTokens ?? 800
      )
    : null;
  if (cacheKey) {
    const cached = readJsonCache(cacheKey);
    if (cached) return cached;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createFn = client.chat.completions.create.bind(client.chat.completions) as (p: any, o?: any) => Promise<OpenAI.Chat.Completions.ChatCompletion>;

  const attemptWithModel = async (
    model: string,
    isFast: boolean,
    retryAttempt = 0
  ): Promise<JsonCompletionResult> => {
    const orExtras = buildOpenRouterChatRequestExtras({
      baseURL: client.baseURL,
      modelSlug: model,
      isFastModel: isFast,
      routeState: opts.routeState,
      sessionId: opts.sessionId ?? opts.userId,
      retryAttempt,
    });
    // Same prompt-cache breakpoint logic as the main model — fast sidecar calls
    // (intent / distill / critic / safety judge) also see the same big static
    // prefix when they reuse the conversation messages.
    const cachedMessages = applyPromptCacheBreakpoints(
      opts.messages as unknown as Message[]
    ) as unknown as typeof opts.messages;
    try {
      const res = await withProviderRequestSpacing(
        { apiKey: client.apiKey, baseURL: client.baseURL },
        () =>
          createFn(
            {
              model,
              messages: cachedMessages,
              max_tokens: opts.maxTokens ?? 800,
              temperature: opts.temperature ?? 0.2,
              response_format: { type: "json_object" },
              ...orExtras,
            },
            opts.signal ? { signal: opts.signal } : undefined
          )
      );
      const raw = res.choices[0]?.message?.content ?? "";
      if (!raw.trim()) return { ok: false, error: "empty completion", raw };
      const parsed = JSON.parse(raw) as unknown;
      return { ok: true, parsed, raw };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      const exhaustedRouting = isExhaustedProviderRoutingError(e);
      if (exhaustedRouting && opts.routeState) {
        opts.routeState.clearProviderIgnores();
      }
      if (
        retryAttempt === 0 &&
        (isRateLimitErrorMessage(error) || exhaustedRouting) &&
        opts.routeState &&
        !(isManagedInferenceBaseUrl(client.baseURL) && vireonProxyAlreadyRetriedUpstream(e))
      ) {
        if (!exhaustedRouting) {
          const slug = parseOpenRouterProviderSlug(e);
          const strategy = resolveProviderStrategy();
          const bumpEpoch =
            sessionEpochBumpOn429Enabled() && strategy === "adaptive";
          if (slug) {
            opts.routeState.markProviderRateLimited(slug, { bumpEpoch });
          } else if (bumpEpoch) {
            opts.routeState.markProviderRateLimited("", { bumpEpoch: true });
          }
        }
        return attemptWithModel(model, isFast, retryAttempt + 1);
      }
      return {
        ok: false,
        error,
        raw: "",
      };
    }
  };

  const cacheOk = (r: JsonCompletionResult): JsonCompletionResult => {
    if (cacheKey && r.ok && r.raw.trim()) {
      writeJsonCache(cacheKey, r.raw, cacheCfg.ttlMs, cacheCfg.max);
    }
    return r;
  };

  const primary = await attemptWithModel(opts.model, opts.isFastModel ?? true);
  if (primary.ok || !opts.fallbackModel || opts.fallbackModel === opts.model) return cacheOk(primary);

  // Retry with fallback model on quota or transient server errors.
  const isRetryableError = isRateLimitErrorMessage(primary.error);
  if (!isRetryableError) return primary;

  console.warn(`[router] fast model "${opts.model}" failed (${primary.error.slice(0, 80)}); retrying with fallback "${opts.fallbackModel}"`);
  return cacheOk(await attemptWithModel(opts.fallbackModel, false));
}
