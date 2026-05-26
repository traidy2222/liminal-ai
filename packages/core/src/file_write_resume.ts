/**
 * Helpers for harness length-resume when file-write tool args are truncated.
 */
import type { AccumulatedToolCall } from "./types.js";

export const FILE_WRITE_TOOL_NAMES = new Set([
  "write_file",
]);

export function isFileWriteToolName(name: string): boolean {
  return FILE_WRITE_TOOL_NAMES.has(name);
}

/** Tools that may dispatch as soon as streamed args are valid JSON (not only at stream end). */
export function canEagerDispatchTool(tool: {
  requiresApproval?: boolean;
  dangerLevel?: "safe" | "cautious" | "destructive";
}): boolean {
  const needsHuman = tool.requiresApproval === true && tool.dangerLevel === "destructive";
  return !needsHuman;
}

export function shouldEagerDispatchWhenArgsComplete(
  toolName: string,
  tool: { requiresApproval?: boolean; dangerLevel?: "safe" | "cautious" | "destructive" },
  pasteEnabled: boolean
): boolean {
  if (!canEagerDispatchTool(tool)) return false;
  if (isFileWriteToolName(toolName)) return true;
  return pasteEnabled && (tool.dangerLevel === "safe" || !tool.dangerLevel);
}

export function tryParseToolArgs(argsJson: string): { ok: true; args: Record<string, unknown> } | { ok: false } {
  try {
    const args = JSON.parse(argsJson || "{}") as Record<string, unknown>;
    if (args === null || typeof args !== "object" || Array.isArray(args)) {
      return { ok: false };
    }
    return { ok: true, args };
  } catch {
    return { ok: false };
  }
}

function isAsciiWordChar(c: string): boolean {
  return /[A-Za-z0-9_]/.test(c);
}

/** Possessive/contraction apostrophe inside a word — not a string delimiter. */
function isApostropheInWord(text: string, index: number): boolean {
  if (text[index] !== "'") return false;
  const prev = index > 0 ? text[index - 1]! : "";
  const next = index + 1 < text.length ? text[index + 1]! : "";
  return isAsciiWordChar(prev) && isAsciiWordChar(next);
}

/** Heuristic: model may have stopped mid-string in tool arg content. */
export function isLikelyTruncatedFileContent(content: string): boolean {
  const t = content.trimEnd();
  if (t.length === 0) return false;
  const last = t[t.length - 1]!;
  if (last === "\\") return true;
  if (/[`"'([{<]$/.test(t)) return true;
  if (t.endsWith("<!--")) return true;
  let sq = 0;
  let dbl = 0;
  let bt = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    const escaped = i > 0 && t[i - 1] === "\\";
    if (c === "'" && !escaped && !isApostropheInWord(t, i)) sq ^= 1;
    if (c === '"' && !escaped) dbl ^= 1;
    if (c === "`" && !escaped) bt ^= 1;
  }
  return sq === 1 || dbl === 1 || bt === 1;
}

export function fileWriteToolNeedsLengthResume(tc: AccumulatedToolCall, finishReason: string | null): boolean {
  if (!isFileWriteToolName(tc.name)) return false;
  const parsed = tryParseToolArgs(tc.argsJson);
  if (!parsed.ok) {
    return finishReason === "length" || finishReason === "tool_calls" || finishReason == null;
  }
  const content = parsed.args["content"];
  if (typeof content === "string" && isLikelyTruncatedFileContent(content)) {
    return true;
  }
  return false;
}

export function batchHasUndispatchableFileWrites(
  toolCalls: AccumulatedToolCall[],
  finishReason: string | null
): boolean {
  for (const tc of toolCalls) {
    if (!isFileWriteToolName(tc.name)) continue;
    const parsed = tryParseToolArgs(tc.argsJson);
    if (!parsed.ok) return true;
    if (fileWriteToolNeedsLengthResume(tc, finishReason)) return true;
  }
  return false;
}

/** Whether the harness should run the post-stream tool dispatch batch. */
export function shouldDispatchToolBatch(
  toolCalls: AccumulatedToolCall[],
  finishReason: string | null
): boolean {
  if (toolCalls.length === 0) return false;
  if (batchHasUndispatchableFileWrites(toolCalls, finishReason)) return false;
  if (!toolCalls.every((tc) => tryParseToolArgs(tc.argsJson).ok)) return false;
  return (
    finishReason === "tool_calls" ||
    finishReason === "stop" ||
    finishReason === "length" ||
    finishReason == null
  );
}

export const LENGTH_RESUME_FILE_WRITE_MESSAGE =
  "[CONTINUE] A file-write tool call was cut off (length limit or incomplete JSON). " +
  "Re-issue the same tool from where you left off. For large files use write_file with mode=create once, then mode=append for each follow-up section. " +
  "Do not assume the partial write succeeded.";
