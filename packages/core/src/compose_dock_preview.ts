/**
 * Live compose-dock preview for file writes and email drafts (desktop/web right pane).
 * Parsed on the harness so UIs receive display-ready content on each tool_delta.
 */
import { decodePartialJsonStringField, tryExtractJsonStringField } from "./tool_arg_content_stream.js";
import { extractStreamingWritePreview } from "./streaming_write_preview.js";

export const FILE_COMPOSE_DOCK_TOOLS = new Set(["write_file", "edit_file", "multi_file_apply"]);

export const EMAIL_COMPOSE_DOCK_TOOLS = new Set([
  "gmail_create_draft",
  "gmail_send_message",
  "outlook_create_draft",
  "outlook_send_message",
]);

export function isComposeDockTool(toolName: string): boolean {
  return FILE_COMPOSE_DOCK_TOOLS.has(toolName) || EMAIL_COMPOSE_DOCK_TOOLS.has(toolName);
}

export function isEmailComposeDockTool(toolName: string): boolean {
  return EMAIL_COMPOSE_DOCK_TOOLS.has(toolName);
}

export interface ComposeDockWirePreview {
  kind: "file" | "email";
  path?: string | null;
  content: string;
  charCount: number;
  lineCount: number;
  incomplete: boolean;
  subject?: string | null;
  recipients?: string | null;
  bodyHtml?: string | null;
  bodyPlain?: string | null;
}

function tryExtractRecipientsPreview(raw: string): string | null {
  if (!raw) return null;
  try {
    const decoded = JSON.parse(raw) as { to?: unknown };
    if (Array.isArray(decoded.to)) {
      const joined = decoded.to
        .map((e) => String(e).trim())
        .filter(Boolean)
        .join(", ");
      if (joined) return joined;
    }
  } catch {
    // Streaming partial JSON — fall through.
  }
  const idx = raw.indexOf('"to"');
  if (idx < 0) return null;
  const slice = raw.slice(idx, idx + 600);
  const emails = [
    ...new Set([...slice.matchAll(/[\w.+-]+@[\w.-]+\.\w+/g)].map((m) => m[0]!)),
  ];
  return emails.length > 0 ? emails.join(", ") : null;
}

function extractEmailComposePreview(toolName: string, argsJson: string): ComposeDockWirePreview {
  const subjectPartial = decodePartialJsonStringField(argsJson, "subject");
  const subjectClosed = tryExtractJsonStringField(argsJson, "subject");
  const subject = (subjectClosed ?? subjectPartial.value).trim() || null;

  const htmlPartial = decodePartialJsonStringField(argsJson, "body_html");
  const htmlClosed = tryExtractJsonStringField(argsJson, "body_html");
  const bodyHtml = (htmlPartial.value || htmlClosed || "").trim() || null;

  const plainPartial = decodePartialJsonStringField(argsJson, "body");
  const plainClosed = tryExtractJsonStringField(argsJson, "body");
  const bodyPlain = (plainPartial.value || plainClosed || "").trim() || null;

  const recipients = tryExtractRecipientsPreview(argsJson);
  const display = bodyHtml ?? bodyPlain ?? "";
  const lines = display.split("\n");
  const charCount =
    (bodyHtml?.length ?? 0) + (bodyPlain?.length ?? 0) + (subject?.length ?? 0);

  return {
    kind: "email",
    path: subject,
    content: display,
    charCount,
    lineCount: lines.length,
    incomplete: bodyHtml
      ? !htmlPartial.closed && htmlClosed == null
      : bodyPlain
        ? !plainPartial.closed && plainClosed == null
        : true,
    subject,
    recipients,
    bodyHtml,
    bodyPlain,
  };
}

/** Build wire-safe compose preview for tool_delta (null when nothing to show yet). */
export function extractComposeDockWirePreview(
  toolName: string,
  argsJson: string
): ComposeDockWirePreview | null {
  if (!isComposeDockTool(toolName)) return null;

  if (isEmailComposeDockTool(toolName)) {
    return extractEmailComposePreview(toolName, argsJson);
  }

  const preview = extractStreamingWritePreview(toolName, argsJson, { fullContent: true });
  if (!preview) return null;

  const display =
    preview.content.length > 0 ? preview.content : (preview.rawArgsTail ?? "");

  return {
    kind: "file",
    path: preview.label,
    content: display,
    charCount: preview.charCount,
    lineCount: preview.lineCount,
    incomplete: preview.incomplete,
  };
}
