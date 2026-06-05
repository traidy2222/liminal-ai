/**
 * Per-chunk idle timeout for provider SSE streams (OpenRouter, etc.).
 * Resets on every chunk — long gaps during reasoning/tool-arg generation need a
 * higher ceiling than legacy 60s defaults.
 */
import { HARNESS_ENV_DEFAULTS } from "./harness_default_constants.js";
import { resolveHarnessEnvRaw } from "./harness_effective_env.js";
import { describeProviderError } from "./inference_provider.js";
import type { ReasoningEffort } from "./reasoning_profile.js";
import type { RuntimePreferences } from "./runtime_prefs.js";

const MIN_MS = 10_000;
const MAX_MS = 600_000;
const FILE_WRITE_MIN_MS = 180_000;

export function parseBaseStreamChunkTimeoutMs(
  prefs?: RuntimePreferences | null | undefined
): number {
  const raw =
    resolveHarnessEnvRaw("AGENT_STREAM_CHUNK_TIMEOUT_MS", prefs ?? null) ??
    HARNESS_ENV_DEFAULTS.AGENT_STREAM_CHUNK_TIMEOUT_MS;
  const n = parseInt(raw, 10);
  const fallback = parseInt(HARNESS_ENV_DEFAULTS.AGENT_STREAM_CHUNK_TIMEOUT_MS, 10) || 120_000;
  return Math.min(MAX_MS, Math.max(MIN_MS, Number.isFinite(n) ? n : fallback));
}

export function isOpenRouterApiBaseUrl(baseURL: string | undefined): boolean {
  if (!baseURL) return false;
  try {
    const host = new URL(baseURL).hostname.toLowerCase();
    return host === "openrouter.ai" || host.endsWith(".openrouter.ai");
  } catch {
    return /openrouter\.ai/i.test(baseURL);
  }
}

const LARGE_TOOL_ARG_MIN_MS = 180_000;

export interface StreamChunkTimeoutContext {
  baseURL?: string;
  reasoningEffort?: ReasoningEffort | null;
  fileWriteSinkActive?: boolean;
  /**
   * The model is mid-way through streaming one large single tool argument
   * (long email/HTML body, big file write, etc.) — independent of the
   * file-write stream sink. Such phases have long inter-chunk gaps.
   */
  largeToolArgInFlight?: boolean;
  runtimePreferences?: RuntimePreferences | null | undefined;
}

/** Effective idle timeout for one stream chunk (ms). */
export function resolveStreamChunkTimeoutMs(ctx: StreamChunkTimeoutContext): number {
  let ms = parseBaseStreamChunkTimeoutMs(ctx.runtimePreferences);

  const effort = ctx.reasoningEffort;
  if (effort === "high" || effort === "xhigh") {
    ms = Math.max(ms, 180_000);
  } else if (effort === "medium" && isOpenRouterApiBaseUrl(ctx.baseURL)) {
    ms = Math.max(ms, 150_000);
  }

  // A large single tool argument streaming (any tool — gmail body, write_file,
  // etc.) warrants a generous ceiling even without the file-write sink.
  if (ctx.largeToolArgInFlight) {
    ms = Math.max(ms, LARGE_TOOL_ARG_MIN_MS);
  }

  if (ctx.fileWriteSinkActive) {
    ms = Math.max(ms * 4, FILE_WRITE_MIN_MS);
  }

  return Math.min(MAX_MS, ms);
}

/** Mid-stream transport failures worth restarting the completion (not user errors). */
export function isStreamTransportRetryable(err: unknown): boolean {
  const msg = describeProviderError(err).toLowerCase();
  if (msg.includes("stream_chunk_timeout")) return true;
  return (
    /network connection lost|connection lost before|premature (close|end)|stream aborted|aborted.*stream|error in input stream|failed to parse stream|parsing stream|und_err/.test(
      msg
    ) || /econnreset|socket hang up|etimedout|econnaborted|fetch failed/.test(msg)
  );
}
