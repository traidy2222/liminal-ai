/**
 * Length-resume + JSON repair for streaming email compose tool args (gmail/outlook).
 */
import { EMAIL_COMPOSE_DOCK_TOOLS, isEmailComposeDockTool } from "./compose_dock_preview.js";
import type { AccumulatedToolCall } from "./types.js";
import {
  decodePartialJsonStringField,
  tryExtractJsonStringField,
} from "./tool_arg_content_stream.js";
import { isLikelyTruncatedFileContent, tryParseToolArgs } from "./file_write_resume.js";

export const EMAIL_COMPOSE_TOOL_NAMES = EMAIL_COMPOSE_DOCK_TOOLS;

export function isEmailComposeToolName(name: string): boolean {
  return isEmailComposeDockTool(name);
}

function extractEmailsNearField(raw: string, fieldName: string, window = 900): string[] {
  const idx = raw.indexOf(`"${fieldName}"`);
  if (idx < 0) return [];
  const slice = raw.slice(idx, idx + window);
  return [...new Set([...slice.matchAll(/[\w.+-]+@[\w.-]+\.\w+/g)].map((m) => m[0]!))];
}

/** Rebuild valid compose JSON from a truncated streaming tool-call args string. */
export function tryRepairEmailComposeArgsJson(raw: string, toolName: string): string | null {
  if (!raw.trim() || !isEmailComposeToolName(toolName)) return null;
  if (tryParseToolArgs(raw).ok) return null;

  if (toolName === "gmail_send_draft") {
    const draftId =
      tryExtractJsonStringField(raw, "draft_id") ??
      decodePartialJsonStringField(raw, "draft_id").value.trim();
    if (!draftId) return null;
    return JSON.stringify({ draft_id: draftId });
  }

  const to = extractEmailsNearField(raw, "to");
  if (to.length === 0) return null;

  const subject =
    (tryExtractJsonStringField(raw, "subject") ??
      decodePartialJsonStringField(raw, "subject").value).trim();
  if (!subject) return null;

  const htmlPartial = decodePartialJsonStringField(raw, "body_html");
  const htmlClosed = tryExtractJsonStringField(raw, "body_html");
  const bodyHtml = (htmlClosed ?? htmlPartial.value).trim();

  const plainPartial = decodePartialJsonStringField(raw, "body");
  const plainClosed = tryExtractJsonStringField(raw, "body");
  const bodyPlain = (plainClosed ?? plainPartial.value).trim();

  if (!bodyHtml && !bodyPlain) return null;

  const out: Record<string, unknown> = { to, subject };
  const cc = extractEmailsNearField(raw, "cc");
  const bcc = extractEmailsNearField(raw, "bcc");
  if (cc.length) out.cc = cc;
  if (bcc.length) out.bcc = bcc;
  if (bodyPlain) out.body = bodyPlain;
  if (bodyHtml) out.body_html = bodyHtml;

  const threadId =
    tryExtractJsonStringField(raw, "thread_id") ??
    tryExtractJsonStringField(raw, "threadId") ??
    decodePartialJsonStringField(raw, "thread_id").value.trim();
  if (threadId) out.thread_id = threadId;

  const repaired = JSON.stringify(out);
  return tryParseToolArgs(repaired).ok ? repaired : null;
}

export function emailComposeToolNeedsLengthResume(
  tc: AccumulatedToolCall,
  finishReason: string | null
): boolean {
  if (!isEmailComposeToolName(tc.name)) return false;
  const parsed = tryParseToolArgs(tc.argsJson);
  if (!parsed.ok) {
    return finishReason === "length" || finishReason === "tool_calls" || finishReason == null;
  }
  if (tc.name === "gmail_send_draft") return false;
  for (const key of ["body_html", "body"] as const) {
    const body = parsed.args[key];
    if (typeof body === "string" && isLikelyTruncatedFileContent(body)) return true;
  }
  return finishReason === "length";
}

export function batchHasUndispatchableEmailCompose(
  toolCalls: AccumulatedToolCall[],
  finishReason: string | null
): boolean {
  for (const tc of toolCalls) {
    if (!isEmailComposeToolName(tc.name)) continue;
    const parsed = tryParseToolArgs(tc.argsJson);
    if (!parsed.ok) return true;
    if (emailComposeToolNeedsLengthResume(tc, finishReason)) return true;
  }
  return false;
}

export const LENGTH_RESUME_EMAIL_COMPOSE_MESSAGE =
  "[CONTINUE] An email compose tool call was cut off (length limit or incomplete JSON). " +
  "Re-issue the SAME tool with the same core args. If a large payload field was truncated, send a shorter complete version. " +
  "If this tool already succeeded for the same intent this turn, reuse that result and continue with the next step.";

/** Args safe to store in assistant tool_calls history (providers reject malformed JSON). */
export function sanitizeToolCallArgsForContext(argsJson: string): string {
  if (tryParseToolArgs(argsJson).ok) return argsJson;
  return "{}";
}
