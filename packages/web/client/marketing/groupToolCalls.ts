import type { MessageEntry } from "../useSSE.js";
import type { ToolCallEntry, ToolCallGroup } from "../persona/ShellContract.js";

const PARALLEL_WINDOW_MS = 4000;

function parallelGroupMin(toolName: string): number {
  if (toolName === "web_search" || toolName === "web_fetch") return 2;
  return 3;
}

/** Same grouping rules as App.tsx — keeps marketing captures aligned with production UI. */
export function groupToolCalls(messages: MessageEntry[]): (MessageEntry | ToolCallGroup)[] {
  const out: (MessageEntry | ToolCallGroup)[] = [];
  let i = 0;
  while (i < messages.length) {
    const m = messages[i]!;
    if (m.kind !== "tool_call") {
      out.push(m);
      i++;
      continue;
    }
    const group: ToolCallEntry[] = [m];
    let j = i + 1;
    while (j < messages.length) {
      const next = messages[j]!;
      if (next.kind !== "tool_call" || next.name !== m.name) break;
      if (next.startedAt - m.startedAt > PARALLEL_WINDOW_MS) break;
      group.push(next);
      j++;
    }
    const min = parallelGroupMin(m.name);
    if (group.length >= min) {
      out.push({ kind: "tool_group", name: m.name, entries: group });
      i = j;
    } else {
      out.push(m);
      i++;
    }
  }
  return out;
}
