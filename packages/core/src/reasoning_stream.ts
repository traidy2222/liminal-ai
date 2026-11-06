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

/** Provider-native continuation data. Keep it separate from visible assistant text. */
export class ProviderReasoningAccumulator {
  private reasoning = "";
  private reasoningContent = "";
  private details: Record<string, unknown>[] = [];
  private detailKeys = new Map<string, number>();

  ingest(delta: unknown): void {
    if (!delta || typeof delta !== "object") return;
    const d = delta as Record<string, unknown>;
    if (typeof d.reasoning === "string") this.reasoning += d.reasoning;
    if (typeof d.reasoning_content === "string") this.reasoningContent += d.reasoning_content;
    if (!Array.isArray(d.reasoning_details)) return;
    for (const item of d.reasoning_details) {
      if (!item || typeof item !== "object") continue;
      const part = item as Record<string, unknown>;
      const key = typeof part.index === "number" ? `index:${part.index}` :
        typeof part.id === "string" ? `id:${part.id}` : undefined;
      const found = key === undefined ? undefined : this.detailKeys.get(key);
      if (found === undefined) {
        if (key !== undefined) this.detailKeys.set(key, this.details.length);
        this.details.push({...part});
      } else {
        const block = this.details[found]!;
        for (const [field, value] of Object.entries(part)) {
          if (["text", "summary", "data", "signature"].includes(field) && typeof value === "string") {
            block[field] = String(block[field] ?? "") + value;
          } else if (value !== undefined && value !== null) block[field] = value;
        }
      }
    }
  }

  snapshot(): {reasoning?: string; reasoning_content?: string; reasoning_details?: Record<string,unknown>[]} {
    return {
      ...(this.reasoning ? {reasoning:this.reasoning} : {}),
      ...(this.reasoningContent ? {reasoning_content:this.reasoningContent} : {}),
      ...(this.details.length ? {reasoning_details:this.details.map(item=>({...item}))} : {}),
    };
  }

  reset(): void {this.reasoning="";this.reasoningContent="";this.details=[];this.detailKeys.clear();}
}
