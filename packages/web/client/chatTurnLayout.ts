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

function isAssistant(row: TurnRow): row is Extract<MessageEntry, { kind: "assistant" }> {
  return !isToolGroup(row) && row.kind === "assistant";
}

function countsAsWorkingActivity(row: TurnRow): boolean {
  if (isToolGroup(row)) return true;
  switch (row.kind) {
    case "working_note":
    case "think":
    case "reason":
    case "plan":
    case "tool_call":
    case "model_reasoning":
    case "subtask":
    case "working_state":
    case "turn_header":
    case "trace":
    case "provider_retry":
    case "context_compressed":
    case "pulse_nudge":
      return true;
    default:
      return false;
  }
}

function splitTurnBuffer(
  user: Extract<MessageEntry, { kind: "user" }> | null,
  entries: TurnRow[],
  isActive: boolean
): ChatTurn {
  const assistants = entries.filter(isAssistant);
  const finalReply = assistants.length > 0 ? assistants[assistants.length - 1]! : null;

  const working = entries.filter((row) => {
    if (!isToolGroup(row) && (row.kind === "tool_result" || row.kind === "user")) return false;
    if (isAssistant(row)) return row !== finalReply;
    return true;
  });

  const hasWorkingActivity = working.some(countsAsWorkingActivity);

  if (!hasWorkingActivity && finalReply) {
    return { user, working: [], finalReply, isActive };
  }

  return { user, working, finalReply, isActive };
}

/** Group a flat transcript into user → working → final-reply turns. */
export function groupIntoChatTurns(grouped: TurnRow[], busy: boolean): ChatTurn[] {
  const turns: ChatTurn[] = [];
  let buffer: TurnRow[] = [];
  let currentUser: Extract<MessageEntry, { kind: "user" }> | null = null;

  const flush = () => {
    if (currentUser === null && buffer.length === 0) return;
    turns.push(splitTurnBuffer(currentUser, buffer, false));
    buffer = [];
    currentUser = null;
  };

  for (const row of grouped) {
    if (!isToolGroup(row) && row.kind === "user") {
      flush();
      currentUser = row;
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
    else if (row.kind === "working_note" || row.kind === "think" || row.kind === "reason") notes++;
  }
  const parts: string[] = ["Working"];
  if (tools > 0) parts.push(`${tools} tool${tools === 1 ? "" : "s"}`);
  if (notes > 0) parts.push(`${notes} note${notes === 1 ? "" : "s"}`);
  return parts.join(" · ");
}
