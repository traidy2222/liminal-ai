/** Default context budget when the model slug is unknown. */
export const DEFAULT_MODEL_CONTEXT_TOKENS = 128_000;

/** Safety margin between input + max_tokens and the provider hard limit. */
export const CONTEXT_WINDOW_MARGIN_TOKENS = 1024;

function effectiveContextMargin(contextWindow: number): number {
  // Providers often bill tool schemas / formatting outside the prompt token estimate.
  return Math.max(CONTEXT_WINDOW_MARGIN_TOKENS, Math.floor(contextWindow * 0.05));
}

/** Minimum completion budget when the prompt already fills most of the window. */
export const MIN_CLAMPED_COMPLETION_TOKENS = 256;

/**
 * Best-effort context window for budgeting / max_tokens clamping.
 * Bedrock Anthropic chat models commonly expose ~202752 tokens (per provider errors).
 */
export function resolveModelContextWindowTokens(modelSlug: string): number {
  const m = modelSlug.trim().toLowerCase();
  if (!m) return DEFAULT_MODEL_CONTEXT_TOKENS;
  if (/1m(?:\b|[-_])|1000000|1_000_000/.test(m)) return 1_000_000;
  if (/200k|202752|202_752/.test(m)) return 202_752;
  if (m.startsWith("anthropic.") || m.includes("anthropic/") || m.includes("claude")) {
    return 202_752;
  }
  if (m.startsWith("openai.") || m.includes("openai/") || m.includes("gpt-")) {
    if (/1m|1000000/.test(m)) return 1_000_000;
    if (/128k|131072/.test(m)) return 131_072;
    return 128_000;
  }
  if (m.includes("deepseek")) return 128_000;
  if (m.includes("gemini") && /1m|1000000/.test(m)) return 1_000_000;
  return DEFAULT_MODEL_CONTEXT_TOKENS;
}

/** Shrink max_tokens so input + output stays inside the model context window. */
export function clampMaxCompletionTokensForContext(
  inputTokens: number,
  requestedMax: number | undefined,
  contextWindow: number,
  margin?: number
): number | undefined {
  const effectiveMargin = margin ?? effectiveContextMargin(contextWindow);
  const headroom = contextWindow - inputTokens - effectiveMargin;
  if (requestedMax === undefined || requestedMax <= 0) {
    if (headroom < contextWindow * 0.15) return Math.max(MIN_CLAMPED_COMPLETION_TOKENS, headroom);
    return undefined;
  }
  if (headroom <= 0) return MIN_CLAMPED_COMPLETION_TOKENS;
  return Math.max(MIN_CLAMPED_COMPLETION_TOKENS, Math.min(requestedMax, headroom));
}

export function isContextLengthExceededError(err: unknown): boolean {
  const parts: string[] = [];
  if (err instanceof Error) {
    parts.push(err.message);
    const api = err as Error & { error?: unknown; status?: number };
    if (api.error !== undefined) parts.push(JSON.stringify(api.error));
  } else {
    parts.push(String(err));
  }
  const blob = parts.join(" ").toLowerCase();
  return (
    blob.includes("maximum context length") ||
    blob.includes("context length") ||
    blob.includes("too many tokens") ||
    blob.includes("input_tokens") ||
    (blob.includes("validation_error") && blob.includes("token"))
  );
}

/** Parse provider 400 bodies: "maximum context length is 162144 tokens". */
export function parseContextLimitFromError(err: unknown): number | null {
  const parts: string[] = [];
  if (err instanceof Error) {
    parts.push(err.message);
    const api = err as Error & { error?: unknown };
    if (api.error !== undefined) parts.push(JSON.stringify(api.error));
  } else {
    parts.push(String(err));
  }
  const blob = parts.join(" ");
  const m =
    blob.match(/maximum context length is\s+([\d,]+)\s*tokens?/i) ??
    blob.match(/context length is\s+([\d,]+)\s*tokens?/i) ??
    blob.match(/max(?:imum)?\s+context\s+(?:window\s+)?(?:is\s+)?([\d,]+)/i);
  if (!m?.[1]) return null;
  const n = parseInt(m[1].replace(/,/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}
