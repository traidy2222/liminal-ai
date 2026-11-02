import type { AccumulatedToolCall, StreamChunk, ToolCallStreamDelta } from "./types.js";
import { mergeStreamingToolArgsJson } from "./tool_arg_content_stream.js";
import type OpenAI from "openai";
import { InlineReasoningTagStreamParser } from "./inline_reasoning_tags.js";
import { extractReasoningDeltaFromChunk } from "./reasoning_stream.js";
import { stripProviderSpecialTokens } from "./provider_token_scrub.js";

function sanitizeStreamText(text: string): string {
  return stripProviderSpecialTokens(
    text
      .replace(/\uFFFD/g, "")
      .replace(/([A-Za-z])⚙([A-Za-z])/g, "$1$2")
      // Drop only control chars; keep Unicode punctuation (e.g. en dash for ranges: 3.5–4.0).
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
  );
}

export type ProcessedStreamChunk = StreamChunk & {
  isNewTool?: boolean;
  indexGap?: { expected: number; received: number };
  /** Reasoning extracted from inline think / redacted_reasoning tags in content. */
  inlineReasoningDelta?: string;
};

export class StreamAccumulator {
  private text = "";
  private readonly inlineReasoningParser = new InlineReasoningTagStreamParser();
  private toolCallMap: Map<number, AccumulatedToolCall> = new Map();
  private seenToolStart: Set<number> = new Set();
  /** Indices whose argsJson must not grow after eager dispatch. */
  private frozenIndices = new Set<number>();
  /** Highest tool call index seen so far — used to detect index gaps. */
  private maxToolIndex = -1;
  /** Provider usage payload from the terminal chunk (OpenRouter forwards it
   *  on the last chunk when `usage: { include: true }` is requested or by
   *  default for some providers). Contains `prompt_tokens_details.cached_tokens`
   *  when prompt caching fires. */
  private _usage: unknown = null;

  processChunk(chunk: OpenAI.Chat.Completions.ChatCompletionChunk): ProcessedStreamChunk {
    // Some providers attach `usage` on the terminal chunk (choices may be empty).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chunkUsage = (chunk as any).usage;
    if (chunkUsage && typeof chunkUsage === "object") {
      this._usage = chunkUsage;
    }

    const choice = chunk.choices[0];
    if (!choice) return {};

    const delta = choice.delta;
    const result: ProcessedStreamChunk = {
      finishReason: (choice.finish_reason as StreamChunk["finishReason"]) ?? null,
    };

    if (delta.content) {
      const cleaned = sanitizeStreamText(delta.content);
      const split = this.inlineReasoningParser.ingest(cleaned);
      if (split.userDelta) {
        this.text += split.userDelta;
        result.textDelta = split.userDelta;
      }
      if (split.reasoningDelta) {
        result.inlineReasoningDelta = split.reasoningDelta;
      }
    }

    const reasoningRaw = extractReasoningDeltaFromChunk(delta);
    if (reasoningRaw) {
      const cleaned = sanitizeStreamText(reasoningRaw);
      result.reasoningDelta = cleaned;
    }

    if (delta.tool_calls) {
      const toolCallDeltas: ToolCallStreamDelta[] = [];
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
          entry.argsJson = mergeStreamingToolArgsJson(entry.argsJson, rawArgsDelta);
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
          const streamDelta: ToolCallStreamDelta = {
            index: idx,
            id: entry.id,
            name: entry.name,
            argsDelta: rawArgsDelta,
            isNewTool,
          };
          toolCallDeltas.push(streamDelta);
          result.toolCallDelta = streamDelta;
        }
      }
      if (toolCallDeltas.length > 0) {
        result.toolCallDeltas = toolCallDeltas;
      }
    }

    return result;
  }

  /** Drain parser tail after the last stream chunk (call before reading accumulatedText). */
  finishInlineReasoning(): ProcessedStreamChunk {
    const tail = this.inlineReasoningParser.flush();
    const result: ProcessedStreamChunk = {};
    if (tail.userDelta) {
      this.text += tail.userDelta;
      result.textDelta = tail.userDelta;
    }
    if (tail.reasoningDelta) {
      result.inlineReasoningDelta = tail.reasoningDelta;
    }
    return result;
  }

  get accumulatedText(): string {
    return this.text;
  }

  get accumulatedToolCalls(): AccumulatedToolCall[] {
    return [...this.toolCallMap.values()];
  }

  /** Tool call for the provider stream index (not array position). */
  getToolCallAtIndex(index: number): AccumulatedToolCall | undefined {
    return this.toolCallMap.get(index);
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

  /**
   * True when a not-yet-frozen tool call has accumulated a large argument
   * payload — i.e. the model is mid-way through streaming one big single tool
   * argument (a long email/HTML body, a large file write, etc.). These phases
   * have legitimately long inter-chunk gaps on some providers, so callers raise
   * the per-chunk idle timeout while one is in flight. Independent of the
   * file-write stream sink (which only covers write_file/edit_file).
   */
  hasLargePendingToolArg(thresholdChars = 8000): boolean {
    for (const [idx, tc] of this.toolCallMap.entries()) {
      if (this.frozenIndices.has(idx)) continue;
      if ((tc.argsJson?.length ?? 0) >= thresholdChars) return true;
    }
    return false;
  }

  /** Stop accepting further argument deltas for this tool index (after eager dispatch). */
  freezeToolCallIndex(index: number): void {
    this.frozenIndices.add(index);
  }

  isToolCallIndexFrozen(index: number): boolean {
    return this.frozenIndices.has(index);
  }

  /** Provider usage payload (token counts, including `cached_tokens` when
   *  prompt caching fires). Null until the terminal chunk arrives. */
  get usage(): unknown {
    return this._usage;
  }

  reset(): void {
    this.text = "";
    this.inlineReasoningParser.reset();
    this.toolCallMap.clear();
    this.seenToolStart.clear();
    this.frozenIndices.clear();
    this.maxToolIndex = -1;
    this._usage = null;
  }
}
