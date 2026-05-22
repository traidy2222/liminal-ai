/**
 * Small-model routing + JSON chat completions for distill / rewrite / critic.
 */
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";
import { withProviderRequestSpacing } from "./provider_request_gate.js";
import { effectiveHarnessEnvRaw } from "./harness_effective_env.js";
import { buildProviderRouting } from "./provider_config.js";

export function getFastModelSlug(fallback: string): string {
  const m = effectiveHarnessEnvRaw("AGENT_FAST_MODEL")?.trim();
  return m && m.length > 0 ? m : fallback;
}

export type JsonCompletionResult =
  | { ok: true; parsed: unknown; raw: string }
  | { ok: false; error: string; raw: string };

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
    /** Stable ID for OpenRouter session affinity (task/session ID). */
    userId?: string;
    /** Set true for fast/sidecar model calls — uses AGENT_PROVIDER_ORDER_FAST if set. */
    isFastModel?: boolean;
    /** Main model slug to fall back to if the fast model returns 429/503. */
    fallbackModel?: string;
  }
): Promise<JsonCompletionResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createFn = client.chat.completions.create.bind(client.chat.completions) as (p: any, o?: any) => Promise<OpenAI.Chat.Completions.ChatCompletion>;

  const attemptWithModel = async (model: string, isFast: boolean): Promise<JsonCompletionResult> => {
    const providerRouting = buildProviderRouting(model, isFast);
    try {
      const res = await withProviderRequestSpacing(
        { apiKey: client.apiKey, baseURL: client.baseURL },
        () =>
          createFn(
            {
              model,
              messages: opts.messages,
              max_tokens: opts.maxTokens ?? 800,
              temperature: opts.temperature ?? 0.2,
              response_format: { type: "json_object" },
              ...(providerRouting && { provider: providerRouting }),
              ...(opts.userId ? { user: opts.userId } : {}),
            },
            opts.signal ? { signal: opts.signal } : undefined
          )
      );
      const raw = res.choices[0]?.message?.content ?? "";
      if (!raw.trim()) return { ok: false, error: "empty completion", raw };
      const parsed = JSON.parse(raw) as unknown;
      return { ok: true, parsed, raw };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        raw: "",
      };
    }
  };

  const primary = await attemptWithModel(opts.model, opts.isFastModel ?? true);
  if (primary.ok || !opts.fallbackModel || opts.fallbackModel === opts.model) return primary;

  // Retry with fallback model on quota or transient server errors.
  const isRetryableError = /429|503|quota|rate.?limit|too many/i.test(primary.error);
  if (!isRetryableError) return primary;

  console.warn(`[router] fast model "${opts.model}" failed (${primary.error.slice(0, 80)}); retrying with fallback "${opts.fallbackModel}"`);
  return attemptWithModel(opts.fallbackModel, false);
}
