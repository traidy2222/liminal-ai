import type { MessageEntry } from "./useAgent.js";

export interface WireReplayEntry {
  id: string;
  kind: "user" | "assistant" | "tool_call" | "error";
  text?: string;
  toolName?: string;
  toolCallId?: string;
  toolArgs?: Record<string, unknown>;
  toolOk?: boolean;
  toolOutput?: string;
}

export function replayEntriesToMessages(entries: WireReplayEntry[]): MessageEntry[] {
  const out: MessageEntry[] = [];
  for (const e of entries) {
    if (e.kind === "user" && e.text) {
      out.push({ kind: "user", text: e.text });
      continue;
    }
    if (e.kind === "assistant" && e.text) {
      out.push({ kind: "assistant", text: e.text, streaming: false });
      continue;
    }
    if (e.kind === "tool_call") {
      out.push({
        kind: "tool_call",
        callId: e.toolCallId ?? e.id,
        name: e.toolName ?? "tool",
        argsJson: JSON.stringify(e.toolArgs ?? {}),
        status: "done",
        startedAt: 0,
        endedAt: 0,
      });
      if (e.toolOutput ?? e.text) {
        out.push({
          kind: "tool_result",
          callId: e.toolCallId ?? e.id,
          output: e.toolOutput ?? e.text ?? "",
          ok: e.toolOk !== false,
        });
      }
      continue;
    }
    if (e.kind === "error" && e.text) {
      out.push({ kind: "error", text: e.text });
    }
  }
  return out;
}
