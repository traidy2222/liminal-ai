/**
 * Strip model-specific control tokens that OpenRouter / chat-tuned models reject
 * when they appear in request message bodies.
 */
const SPECIAL_TOKEN_RE =
  /<\|(?:endoftext|im_start|im_end|eot_id|start_of_text|end_of_text)\|>/gi;

export function stripProviderSpecialTokens(text: string): string {
  return text.replace(SPECIAL_TOKEN_RE, "");
}

/** Deep-scrub string fields in outbound chat messages before provider calls. */
export function scrubMessagesSpecialTokens<T extends { role: string; content?: unknown }>(
  messages: T[]
): T[] {
  return messages.map((m) => {
    const content = m.content;
    if (typeof content === "string") {
      const cleaned = stripProviderSpecialTokens(content);
      return cleaned === content ? m : { ...m, content: cleaned };
    }
    if (!Array.isArray(content)) return m;
    let changed = false;
    const parts = content.map((part) => {
      if (!part || typeof part !== "object") return part;
      const p = part as Record<string, unknown>;
      if (typeof p.text === "string") {
        const cleaned = stripProviderSpecialTokens(p.text);
        if (cleaned !== p.text) {
          changed = true;
          return { ...p, text: cleaned };
        }
      }
      return part;
    });
    return changed ? { ...m, content: parts } : m;
  });
}
