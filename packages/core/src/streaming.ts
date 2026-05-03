import type { AccumulatedToolCall, StreamChunk } from "./types.js";
import type OpenAI from "openai";

export class StreamAccumulator {
  private text = "";
  private toolCallMap: Map<number, AccumulatedToolCall> = new Map();
  private seenToolStart: Set<number> = new Set();

  processChunk(chunk: OpenAI.Chat.Completions.ChatCompletionChunk): StreamChunk & { isNewTool?: boolean } {
    const choice = chunk.choices[0];
    if (!choice) return {};

    const delta = choice.delta;
    const result: StreamChunk & { isNewTool?: boolean } = {
      finishReason: (choice.finish_reason as StreamChunk["finishReason"]) ?? null,
    };

    if (delta.content) {
      this.text += delta.content;
      result.textDelta = delta.content;
    }

    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index;
        let entry = this.toolCallMap.get(idx);

        if (!entry) {
          entry = { id: tc.id ?? "", name: tc.function?.name ?? "", argsJson: "" };
          this.toolCallMap.set(idx, entry);
        }

        if (tc.id && !entry.id) entry.id = tc.id;
        if (tc.function?.name && !entry.name) entry.name = tc.function.name;

        const argsDelta = tc.function?.arguments ?? "";
        entry.argsJson += argsDelta;

        const isNewTool = !this.seenToolStart.has(idx) && !!entry.name && !!entry.id;
        if (isNewTool) {
          this.seenToolStart.add(idx);
          result.isNewTool = true;
        }

        result.toolCallDelta = {
          index: idx,
          id: entry.id,
          name: entry.name,
          argsDelta: argsDelta || undefined,
        };
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

  reset(): void {
    this.text = "";
    this.toolCallMap.clear();
    this.seenToolStart.clear();
  }
}
