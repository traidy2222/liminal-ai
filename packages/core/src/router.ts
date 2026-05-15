/**
 * Small-model routing + JSON chat completions for distill / rewrite / critic.
 */
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";
import { withProviderRequestSpacing } from "./provider_request_gate.js";
import { effectiveHarnessEnvRaw } from "./harness_effective_env.js";

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
  }
): Promise<JsonCompletionResult> {
  try {
    const res = await withProviderRequestSpacing(
      { apiKey: client.apiKey, baseURL: client.baseURL },
      () =>
        client.chat.completions.create({
          model: opts.model,
          messages: opts.messages,
          max_tokens: opts.maxTokens ?? 800,
          temperature: opts.temperature ?? 0.2,
          response_format: { type: "json_object" },
          ...(opts.signal ? { signal: opts.signal } : {}),
        })
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
}
