/**
 * Extract provider-native reasoning text from OpenAI-compatible streaming deltas
 * (OpenRouter: reasoning, reasoning_content, reasoning_details[]).
 */
export function extractReasoningDeltaFromChunk(delta: unknown): string | null {
  if (!delta || typeof delta !== "object") return null;
  const d = delta as Record<string, unknown>;

  if (typeof d.reasoning === "string" && d.reasoning.length > 0) {
    return d.reasoning;
  }
  if (typeof d.reasoning_content === "string" && d.reasoning_content.length > 0) {
    return d.reasoning_content;
  }

  const details = d.reasoning_details;
  if (!Array.isArray(details) || details.length === 0) return null;

  const parts: string[] = [];
  for (const item of details) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (typeof o.text === "string" && o.text.length > 0) parts.push(o.text);
    else if (typeof o.summary === "string" && o.summary.length > 0) parts.push(o.summary);
  }
  return parts.length > 0 ? parts.join("") : null;
}
