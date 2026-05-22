import type { AccumulatedToolCall, StreamChunk } from "./types.js";
import type OpenAI from "openai";
import { extractReasoningDeltaFromChunk } from "./reasoning_stream.js";

function sanitizeStreamText(text: string): string {
  return text
    .replace(/\uFFFD/g, "")
    .replace(/([A-Za-z])⚙([A-Za-z])/g, "$1$2")
    // Drop only control chars; keep Unicode punctuation (e.g. en dash for ranges: 3.5–4.0).
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

export class StreamAccumulator {
  private text = "";
  private toolCallMap: Map<number, AccumulatedToolCall> = new Map();
  private seenToolStart: Set<number> = new Set();
  /** Indices whose argsJson must not grow after eager dispatch. */
  private frozenIndices = new Set<number>();
  /** Highest tool call index seen so far — used to detect index gaps. */
  private maxToolIndex = -1;

  processChunk(chunk: OpenAI.Chat.Completions.ChatCompletionChunk): StreamChunk & { isNewTool?: boolean; indexGap?: { expected: number; received: number } } {
    const choice = chunk.choices[0];
    if (!choice) return {};

    const delta = choice.delta;
    const result: StreamChunk & { isNewTool?: boolean; indexGap?: { expected: number; received: number } } = {
      finishReason: (choice.finish_reason as StreamChunk["finishReason"]) ?? null,
    };

    if (delta.content) {
      const cleaned = sanitizeStreamText(delta.content);
      this.text += cleaned;
      result.textDelta = cleaned;
    }

    const reasoningRaw = extractReasoningDeltaFromChunk(delta);
    if (reasoningRaw) {
      const cleaned = sanitizeStreamText(reasoningRaw);
      result.reasoningDelta = cleaned;
    }

    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index;

        // Detect non-contiguous index (provider skipped an index — possible misalignment).
        if (!this.toolCallMap.has(idx) && idx > this.maxToolIndex + 1) {
          result.indexGap = { expected: this.maxToolIndex + 1, received: idx };
        }
        if (idx > this.maxToolIndex) this.maxToolIndex = idx;

        let entry = this.toolCallMap.get(idx);

        if (!entry) {
          entry = { id: tc.id ?? "", name: tc.function?.name ?? "", argsJson: "" };
          this.toolCallMap.set(idx, entry);
        }

        if (tc.id && !entry.id) entry.id = tc.id;
        if (tc.function?.name && !entry.name) entry.name = tc.function.name;

        const rawArgsDelta = tc.function?.arguments ?? "";
        const frozen = this.frozenIndices.has(idx);
        if (!frozen && rawArgsDelta) {
          entry.argsJson += rawArgsDelta;
        }

        const isNewTool = !this.seenToolStart.has(idx) && !!entry.name && !!entry.id;
        if (isNewTool) {
          this.seenToolStart.add(idx);
          result.isNewTool = true;
        }

        // Emit toolCallDelta on new-tool discovery (even with empty argsDelta) so
        // callers can emit tool_start reliably — the first OpenAI-format streaming
        // chunk carries name+id but arguments:"", which previously prevented
        // tool_start from firing when isNewTool and toolCallDelta were in separate chunks.
        if (!frozen && (isNewTool || rawArgsDelta)) {
          result.toolCallDelta = {
            index: idx,
            id: entry.id,
            name: entry.name,
            argsDelta: rawArgsDelta,
          };
        }
      }
    }

    return result;
  }

  get accumulatedText(): string {
    return this.text;
  }

  get accumulatedToolCalls(): AccumulatedToolCall[] {
    return [...this.toolCallMap.values()];
  }

  /**
   * Return the accumulated tool call at `index` if its argsJson is syntactically
   * complete (valid JSON). Used by PASTE to speculatively dispatch call[N-1]
   * when the stream begins emitting call[N].
   */
  tryGetCompletedCall(index: number): AccumulatedToolCall | undefined {
    const tc = this.toolCallMap.get(index);
    if (!tc || !tc.id || !tc.name) return undefined;
    try {
      JSON.parse(tc.argsJson || "{}");
      return tc;
    } catch {
      return undefined;
    }
  }

  /** Stop accepting further argument deltas for this tool index (after eager dispatch). */
  freezeToolCallIndex(index: number): void {
    this.frozenIndices.add(index);
  }

  isToolCallIndexFrozen(index: number): boolean {
    return this.frozenIndices.has(index);
  }

  reset(): void {
    this.text = "";
    this.toolCallMap.clear();
    this.seenToolStart.clear();
    this.frozenIndices.clear();
    this.maxToolIndex = -1;
  }
}
