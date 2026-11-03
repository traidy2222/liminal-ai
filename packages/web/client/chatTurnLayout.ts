import type { MessageEntry } from "./useSSE.js";
import type { ToolCallGroup } from "./persona/ShellContract.js";

export type TurnRow = MessageEntry | ToolCallGroup;

export interface ChatTurn {
  user: Extract<MessageEntry, { kind: "user" }> | null;
  working: TurnRow[];
  finalReply: Extract<MessageEntry, { kind: "assistant" }> | null;
  /** True while this is the last turn and the harness is still busy. */
  isActive: boolean;
}

function isToolGroup(row: TurnRow): row is ToolCallGroup {
  return "kind" in row && row.kind === "tool_group";
}

/** Seal narration without turning it into a hidden working-panel note. */
export function sealAssistantSegment(messages: MessageEntry[]): MessageEntry[] {
  const last = messages.at(-1);
  if (last?.kind !== "assistant") return messages;
  if (!last.text.trim()) return messages.slice(0, -1);
  return [...messages.slice(0, -1), { ...last, streaming: false }];
}

/** Split display blocks at each assistant segment, preserving tool/text order. */
export function groupIntoChatTurns(
  grouped: TurnRow[],
  busy: boolean,
): ChatTurn[] {
  const turns: ChatTurn[] = [];
  let buffer: TurnRow[] = [];
  let currentUser: Extract<MessageEntry, { kind: "user" }> | null = null;

  const flush = (reply: ChatTurn["finalReply"] = null) => {
    if (currentUser === null && buffer.length === 0 && !reply) return;
    turns.push({
      user: currentUser,
      working: buffer,
      finalReply: reply,
      isActive: false,
    });
    buffer = [];
    currentUser = null;
  };

  for (const row of grouped) {
    if (!isToolGroup(row) && row.kind === "user") {
      flush();
      currentUser = row;
      continue;
    }
    if (
      !isToolGroup(row) &&
      (row.kind === "assistant" || row.kind === "working_note")
    ) {
      if (row.text.trim())
        flush(
          row.kind === "assistant"
            ? row
            : {
                kind: "assistant",
                text: row.text,
                streaming: row.streaming === true,
              },
        );
      continue;
    }
    if (!isToolGroup(row) && row.kind === "tool_result") continue;
    // Completion metadata belongs with the preceding reply, not a new working
    // panel after the final answer. It never combines assistant segments.
    if (
      !isToolGroup(row) &&
      (row.kind === "turn_header" || row.kind === "working_state") &&
      currentUser === null &&
      buffer.length === 0 &&
      turns.at(-1)?.finalReply
    ) {
      turns.at(-1)!.working.push(row);
      continue;
    }
    buffer.push(row);
  }
  flush();

  if (turns.length > 0 && busy) {
    const last = turns[turns.length - 1]!;
    turns[turns.length - 1] = { ...last, isActive: true };
  }

  return turns;
}

export function summarizeWorkingPanel(working: TurnRow[]): string {
  let tools = 0;
  let notes = 0;
  for (const row of working) {
    if (isToolGroup(row)) {
      tools += row.entries.length;
      continue;
    }
    if (row.kind === "tool_call") tools++;
    else if (
      row.kind === "working_note" ||
      row.kind === "think" ||
      row.kind === "reason"
    )
      notes++;
  }
  const parts: string[] = ["Working"];
  if (tools > 0) parts.push(`${tools} tool${tools === 1 ? "" : "s"}`);
  if (notes > 0) parts.push(`${notes} note${notes === 1 ? "" : "s"}`);
  return parts.join(" · ");
}
