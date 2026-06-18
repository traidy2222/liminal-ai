/**
 * Rebuild UI transcripts (and lightweight harness context) from per-chat
 * `session.jsonl` event logs.
 */
import { readFile } from "node:fs/promises";
import type { Message } from "./types.js";
import { perChatPath } from "./global_storage.js";
import { legacySessionLogPath } from "./session_event_log.js";

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

function extractMessageText(content: Message["content"]): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter(
        (part): part is { type: "text"; text: string } =>
          typeof part === "object" &&
          part !== null &&
          (part as { type?: string }).type === "text" &&
          typeof (part as { text?: string }).text === "string"
      )
      .map((part) => part.text)
      .join("\n");
  }
  return "";
}

function isHarnessInjectedUserLine(text: string): boolean {
  const trimmed = text.trim();
  return !trimmed || trimmed.startsWith("[");
}

/**
 * Build UI replay rows from an in-memory harness conversation when disk logs
 * are missing (e.g. before the first post-fix write, or mid-session handoff).
 */
export function buildTranscriptReplayFromConversation(
  messages: readonly Message[],
  opts?: { maxEntries?: number }
): ReplayTranscriptEntry[] {
  const maxEntries = opts?.maxEntries ?? 500;
  const out: ReplayTranscriptEntry[] = [];
  const toolNames = new Map<string, string>();
  let turnIndex = 0;

  for (let i = 0; i < messages.length && out.length < maxEntries; i++) {
    const message = messages[i]!;
    if (message.role === "user") {
      const text = extractMessageText(message.content).trim();
      if (isHarnessInjectedUserLine(text)) continue;
      turnIndex += 1;
      out.push({
        id: entryId("user", turnIndex, String(out.length)),
        kind: "user",
        turnIndex,
        text,
      });
      continue;
    }

    if (message.role === "assistant") {
      const text = extractMessageText(message.content).trim();
      if (text && !text.startsWith("[")) {
        out.push({
          id: entryId("assistant", turnIndex, String(out.length)),
          kind: "assistant",
          turnIndex,
          text,
        });
      }
      const toolCalls =
        "tool_calls" in message && Array.isArray(message.tool_calls)
          ? (message.tool_calls as Array<{
              id: string;
              function?: { name?: string };
            }>)
          : [];
      for (const call of toolCalls) {
        if (call.id) toolNames.set(call.id, call.function?.name ?? "tool");
      }
      continue;
    }

    if (message.role === "tool") {
      const toolCallId =
        "tool_call_id" in message && typeof message.tool_call_id === "string"
          ? message.tool_call_id
          : "";
      const output = extractMessageText(message.content);
      const looksFailed =
        output.startsWith("ERROR") ||
        output.startsWith("Error:") ||
        output.includes('"ok":false');
      out.push({
        id: entryId("tool", turnIndex, toolCallId || String(out.length)),
        kind: "tool_call",
        turnIndex,
        toolCallId,
        toolName: toolNames.get(toolCallId) ?? "tool",
        toolOk: !looksFailed,
        toolOutput: output,
        text: output,
      });
    }
  }

  return out;
}

export async function loadChatTranscriptFromSessionLog(
  chatId: string,
  opts?: { maxEntries?: number }
): Promise<ReplayTranscriptEntry[]> {
  for (const target of [sessionLogPath(chatId), legacySessionLogPath(chatId)]) {
    try {
      const raw = await readFile(target, "utf8");
      if (!raw.trim()) continue;
      const entries = parseSessionJsonlForReplay(raw, opts);
      if (entries.length > 0) return entries;
    } catch {
      /* try next path */
    }
  }
  return [];
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
