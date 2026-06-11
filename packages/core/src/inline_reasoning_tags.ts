/**
 * Models such as MiniMax M2 and some DeepSeek variants embed chain-of-thought in the
 * main content stream using XML-like tags instead of a separate reasoning field.
 * Split those blocks into user-visible text vs model-reasoning channel.
 */

export interface InlineReasoningTagPair {
  readonly open: string;
  readonly close: string;
}

const TAG = {
  think: "think",
  redacted: "redacted_reasoning",
  thinking: "thinking",
} as const;

function tag(open: string, close?: string): InlineReasoningTagPair {
  return { open: `<${open}>`, close: `</${close ?? open}>` };
}

/** Known inline-reasoning wrappers (case-insensitive tag names). */
export const INLINE_REASONING_TAG_PAIRS: readonly InlineReasoningTagPair[] = [
  tag(TAG.think),
  tag(TAG.redacted),
  tag(TAG.thinking),
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function indexOfIgnoreCase(haystack: string, needle: string, from = 0): number {
  return haystack.toLowerCase().indexOf(needle.toLowerCase(), from);
}

function findEarliestOpenTag(
  text: string
): { index: number; open: string; close: string } | null {
  let best: { index: number; open: string; close: string } | null = null;
  for (const pair of INLINE_REASONING_TAG_PAIRS) {
    const idx = indexOfIgnoreCase(text, pair.open);
    if (idx < 0) continue;
    if (!best || idx < best.index) {
      best = { index: idx, open: pair.open, close: pair.close };
    }
  }
  return best;
}

/** Longest suffix of `text` that is a prefix of any candidate (partial tag at chunk end). */
function holdPartialPrefix(text: string, candidates: string[]): { emit: string; hold: string } {
  let maxHold = 0;
  for (const candidate of candidates) {
    const limit = Math.min(candidate.length - 1, text.length);
    for (let len = limit; len >= 1; len--) {
      const suffix = text.slice(-len);
      if (candidate.toLowerCase().startsWith(suffix.toLowerCase())) {
        maxHold = Math.max(maxHold, len);
        break;
      }
    }
  }
  if (maxHold === 0) return { emit: text, hold: "" };
  return { emit: text.slice(0, -maxHold), hold: text.slice(-maxHold) };
}

/** Remove inline reasoning blocks from completed assistant text (history / context). */
export function stripInlineReasoningTags(text: string): string {
  let out = text;
  for (const { open, close } of INLINE_REASONING_TAG_PAIRS) {
    const re = new RegExp(
      `${escapeRegExp(open)}[\\s\\S]*?${escapeRegExp(close)}`,
      "gi"
    );
    out = out.replace(re, "");
  }
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

/** Stateful splitter for streaming `delta.content` chunks. */
export class InlineReasoningTagStreamParser {
  private mode: "outside" | "inside" = "outside";
  private closeTag = "";
  private carry = "";

  reset(): void {
    this.mode = "outside";
    this.closeTag = "";
    this.carry = "";
  }

  ingest(chunk: string): { userDelta: string; reasoningDelta: string } {
    let userDelta = "";
    let reasoningDelta = "";
    let rest = this.carry + chunk;
    this.carry = "";

    while (rest.length > 0) {
      if (this.mode === "outside") {
        const hit = findEarliestOpenTag(rest);
        if (!hit) {
          const opens = INLINE_REASONING_TAG_PAIRS.map((p) => p.open);
          const { emit, hold } = holdPartialPrefix(rest, opens);
          userDelta += emit;
          this.carry = hold;
          break;
        }
        userDelta += rest.slice(0, hit.index);
        rest = rest.slice(hit.index + hit.open.length);
        this.mode = "inside";
        this.closeTag = hit.close;
        continue;
      }

      const closeIdx = indexOfIgnoreCase(rest, this.closeTag);
      if (closeIdx < 0) {
        const { emit, hold } = holdPartialPrefix(rest, [this.closeTag]);
        reasoningDelta += emit;
        this.carry = hold;
        break;
      }
      reasoningDelta += rest.slice(0, closeIdx);
      rest = rest.slice(closeIdx + this.closeTag.length);
      this.mode = "outside";
      this.closeTag = "";
    }

    return { userDelta, reasoningDelta };
  }

  /** Flush trailing bytes at end-of-stream (unclosed tag → reasoning). */
  flush(): { userDelta: string; reasoningDelta: string } {
    const tail = this.carry;
    this.carry = "";
    if (this.mode === "inside") {
      return { userDelta: "", reasoningDelta: tail };
    }
    return { userDelta: tail, reasoningDelta: "" };
  }
}
