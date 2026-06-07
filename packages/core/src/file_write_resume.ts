/**
 * Helpers for harness length-resume when file-write tool args are truncated.
 */
import type { AccumulatedToolCall } from "./types.js";

export const FILE_WRITE_TOOL_NAMES = new Set([
  "write_file",
]);

export const SPAWN_APP_TOOL_NAME = "spawn_app";
export const UPDATE_APP_TOOL_NAME = "update_app";
export const LIMINAL_APP_HTML_TOOL_NAMES = new Set([SPAWN_APP_TOOL_NAME, UPDATE_APP_TOOL_NAME]);

export function isFileWriteToolName(name: string): boolean {
  return FILE_WRITE_TOOL_NAMES.has(name);
}

export function isLiminalAppHtmlToolName(name: string): boolean {
  return LIMINAL_APP_HTML_TOOL_NAMES.has(name);
}

/** @deprecated use isLiminalAppHtmlToolName */
export function isSpawnAppToolName(name: string): boolean {
  return isLiminalAppHtmlToolName(name);
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
  // write_file dispatches only in the end-of-stream batch so length-resume and
  // truncation checks run before anything hits disk (no eager mid-stream commit).
  if (isFileWriteToolName(toolName)) return false;
  // speak: `{}` is valid JSON before the "text" field streams in — wait for full args.
  if (toolName === "speak") return false;
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

/** True when a write_file call must not commit to disk yet (truncated / length / bad JSON). */
export function fileWriteSafeToDispatch(
  tc: AccumulatedToolCall,
  finishReason: string | null
): boolean {
  if (!isFileWriteToolName(tc.name)) return true;
  if (!tryParseToolArgs(tc.argsJson).ok) return false;
  return !fileWriteToolNeedsLengthResume(tc, finishReason);
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
  // Valid JSON with complete-looking content may still finish with reason=length when
  // the provider exhausted tokens on the closing brace — allow dispatch in that case.
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

export function liminalAppHtmlToolNeedsLengthResume(
  tc: AccumulatedToolCall,
  finishReason: string | null
): boolean {
  if (!isLiminalAppHtmlToolName(tc.name)) return false;
  const parsed = tryParseToolArgs(tc.argsJson);
  if (!parsed.ok) {
    return finishReason === "length" || finishReason === "tool_calls" || finishReason == null;
  }
  const props = parsed.args["props"];
  if (!props || typeof props !== "object" || Array.isArray(props)) return false;
  const record = props as Record<string, unknown>;
  for (const key of ["html", "markdown"] as const) {
    const body = record[key];
    if (typeof body === "string" && isLikelyTruncatedFileContent(body)) {
      return true;
    }
  }
  return false;
}

/** @deprecated use liminalAppHtmlToolNeedsLengthResume */
export const spawnAppToolNeedsLengthResume = liminalAppHtmlToolNeedsLengthResume;

export function batchHasUndispatchableLiminalAppHtml(
  toolCalls: AccumulatedToolCall[],
  finishReason: string | null
): boolean {
  for (const tc of toolCalls) {
    if (!isLiminalAppHtmlToolName(tc.name)) continue;
    const parsed = tryParseToolArgs(tc.argsJson);
    if (!parsed.ok) return true;
    if (liminalAppHtmlToolNeedsLengthResume(tc, finishReason)) return true;
  }
  return false;
}

/** @deprecated use batchHasUndispatchableLiminalAppHtml */
export const batchHasUndispatchableSpawnApps = batchHasUndispatchableLiminalAppHtml;

/** Whether the harness should run the post-stream tool dispatch batch. */
export function shouldDispatchToolBatch(
  toolCalls: AccumulatedToolCall[],
  finishReason: string | null
): boolean {
  if (toolCalls.length === 0) return false;
  if (batchHasUndispatchableFileWrites(toolCalls, finishReason)) return false;
  if (batchHasUndispatchableLiminalAppHtml(toolCalls, finishReason)) return false;
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

export const LENGTH_RESUME_LIMINAL_APP_HTML_MESSAGE =
  "[CONTINUE] spawn_app or update_app was cut off while streaming widget HTML (length limit or incomplete JSON). " +
  "Re-issue the SAME tool call — the harness stages partial props.html like write_file. " +
  "If list_apps shows the widget already exists, use update_app({ id, props:{ html:\"…\" } }) or html_edit — do NOT spawn_app again. " +
  "New spawn: one spawn_app({ type:\"html\", id:\"<stable-slug>\", props:{ html:\"<!DOCTYPE html>…full document…</html>\" } }). " +
  "Edits: grep_app_html → update_app({ id, html_edit:{ replacements:[...] } }). Widget JS is browser-only (no require/fs).";

/** @deprecated */
export const LENGTH_RESUME_SPAWN_APP_MESSAGE = LENGTH_RESUME_LIMINAL_APP_HTML_MESSAGE;
