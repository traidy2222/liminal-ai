/**
 * Rebuild UI transcripts (and lightweight harness context) from per-chat
 * `session.jsonl` event logs.
 */
import { readFile } from "node:fs/promises";
import { perChatPath } from "./global_storage.js";

export type ReplayEntryKind = "user" | "assistant" | "tool_call" | "error";

export interface ReplayTranscriptEntry {
  id: string;
  kind: ReplayEntryKind;
  turnIndex: number;
  text?: string;
  toolName?: string;
  toolCallId?: string;
  toolArgs?: Record<string, unknown>;
  toolOk?: boolean;
  toolOutput?: string;
}

interface SessionLogRow {
  event?: string;
  turnIndex?: number;
  userMessage?: string;
  text?: string;
  callId?: string;
  name?: string;
  args?: Record<string, unknown>;
  ok?: boolean;
  output?: string;
  error?: string;
  message?: string;
}

function sessionLogPath(chatId: string): string {
  return perChatPath(chatId, "session.jsonl");
}

function entryId(kind: string, turnIndex: number, suffix: string): string {
  return `replay:${kind}:${turnIndex}:${suffix}`;
}

/**
 * Parse `session.jsonl` into ordered transcript entries for UI replay.
 * Tool rounds are collapsed to completed tool_call rows (running state omitted).
 */
export function parseSessionJsonlForReplay(
  raw: string,
  opts?: { maxEntries?: number }
): ReplayTranscriptEntry[] {
  const maxEntries = opts?.maxEntries ?? 500;
  const out: ReplayTranscriptEntry[] = [];
  const pendingTools = new Map<
    string,
    { turnIndex: number; name: string; args?: Record<string, unknown> }
  >();

  const lines = raw.split("\n");
  for (const line of lines) {
    if (!line.trim() || out.length >= maxEntries) continue;
    let row: SessionLogRow;
    try {
      row = JSON.parse(line) as SessionLogRow;
    } catch {
      continue;
    }
    const event = row.event ?? "";
    const turnIndex = typeof row.turnIndex === "number" ? row.turnIndex : 0;

    if (event === "send_start" && row.userMessage) {
      out.push({
        id: entryId("user", turnIndex, String(out.length)),
        kind: "user",
        turnIndex,
        text: row.userMessage,
      });
      continue;
    }

    if (event === "tool_start" && row.callId && row.name) {
      pendingTools.set(row.callId, {
        turnIndex,
        name: row.name,
        args: row.args,
      });
      continue;
    }

    if (event === "tool_result" && row.callId) {
      const pending = pendingTools.get(row.callId);
      pendingTools.delete(row.callId);
      out.push({
        id: entryId("tool", turnIndex, row.callId),
        kind: "tool_call",
        turnIndex,
        toolCallId: row.callId,
        toolName: row.name ?? pending?.name ?? "tool",
        toolArgs: row.args ?? pending?.args,
        toolOk: row.ok === true,
        toolOutput: row.ok === true ? row.output : row.error,
        text: row.ok === true ? row.output : row.error,
      });
      continue;
    }

    if ((event === "text_rollup" || event === "text_rollup_partial") && row.text) {
      out.push({
        id: entryId("assistant", turnIndex, String(out.length)),
        kind: "assistant",
        turnIndex,
        text: row.text,
      });
      continue;
    }

    if (event === "error" && row.message) {
      out.push({
        id: entryId("error", turnIndex, String(out.length)),
        kind: "error",
        turnIndex,
        text: row.message,
      });
    }
  }

  return out;
}

const DEFAULT_WIRE_TOOL_OUTPUT_CHARS = 4000;

/** Shrink tool rows for WebSocket replay so multi-MB sessions do not drop frames. */
export function slimReplayEntriesForWire(
  entries: ReplayTranscriptEntry[],
  opts?: { maxToolOutputChars?: number }
): ReplayTranscriptEntry[] {
  const cap = opts?.maxToolOutputChars ?? DEFAULT_WIRE_TOOL_OUTPUT_CHARS;
  return entries.map((e) => {
    if (e.kind !== "tool_call") return e;
    const raw = e.toolOutput ?? e.text ?? "";
    if (raw.length <= cap) return e;
    const clipped = `${raw.slice(0, cap)}… [${raw.length - cap} chars elided for replay]`;
    return { ...e, toolOutput: clipped, text: clipped };
  });
}

export async function loadChatTranscriptFromSessionLog(
  chatId: string,
  opts?: { maxEntries?: number }
): Promise<ReplayTranscriptEntry[]> {
  try {
    const raw = await readFile(sessionLogPath(chatId), "utf8");
    if (!raw.trim()) return [];
    return parseSessionJsonlForReplay(raw, opts);
  } catch {
    return [];
  }
}

/** User + assistant lines only — for harness context hydration. */
export function conversationEntriesForHydration(
  entries: ReplayTranscriptEntry[],
  opts?: { maxTurns?: number }
): Array<{ role: "user" | "assistant"; content: string }> {
  const maxTurns = opts?.maxTurns ?? 24;
  const pairs: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const e of entries) {
    if (e.kind === "user" && e.text?.trim()) {
      pairs.push({ role: "user", content: e.text });
    } else if (e.kind === "assistant" && e.text?.trim()) {
      pairs.push({ role: "assistant", content: e.text });
    }
    if (pairs.length >= maxTurns * 2) break;
  }
  return pairs.slice(-maxTurns * 2);
}
