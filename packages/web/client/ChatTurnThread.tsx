import React from "react";
import type { MessageEntry } from "./useSSE.js";
import type { ToolCallGroup } from "./persona/ShellContract.js";
import type { ChatTurn, TurnRow } from "./chatTurnLayout.js";
import { WorkingPanel } from "./WorkingPanel.js";

export function ChatTurnThread({
  turns,
  renderUser,
  renderFinalReply,
  renderWorkingEntry,
}: {
  turns: ChatTurn[];
  renderUser: (user: Extract<MessageEntry, { kind: "user" }>) => React.ReactNode;
  renderFinalReply: (reply: Extract<MessageEntry, { kind: "assistant" }>) => React.ReactNode;
  renderWorkingEntry: (entry: TurnRow, key: string) => React.ReactNode;
}) {
  return (
    <>
      {turns.map((turn, ti) => (
        <React.Fragment key={`turn-${ti}`}>
          {turn.user ? renderUser(turn.user) : null}
          {turn.working.length > 0 ? (
            <WorkingPanel working={turn.working} isActive={turn.isActive}>
              {turn.working.map((entry, wi) => renderWorkingEntry(entry, `turn-${ti}-w-${wi}`))}
            </WorkingPanel>
          ) : null}
          {turn.finalReply ? renderFinalReply(turn.finalReply) : null}
        </React.Fragment>
      ))}
    </>
  );
}

export function skipUserOrAssistantRow(entry: TurnRow): entry is MessageEntry {
  if ("kind" in entry && entry.kind === "tool_group") return false;
  return entry.kind !== "user" && entry.kind !== "assistant";
}

export type { ToolCallGroup };
