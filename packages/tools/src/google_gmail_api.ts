/**
 * Gmail via classic REST API (gmail.googleapis.com) — works without Workspace MCP preview.
 * Uses the same OAuth token as connect google / Integrations.
 */
import { effectiveHarnessEnvRaw, getGoogleAccessToken, resolveGoogleGmailTransport } from "@liminal/core";
import type { PropertySchema, ToolDefinition, ToolResult } from "@liminal/core";
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { defineTool } from "./helpers.js";
import {
  buildMimeMessage,
  decodeHtmlEntities,
  decodeMimeHeaderValue,
  extractEmailBody,
  normalizeEmailWhitespace,
  type GmailPartLike,
  type MimeBlob,
} from "./gmail_message_body.js";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

function gmailRestEnabled(): boolean {
  return effectiveHarnessEnvRaw("AGENT_GOOGLE_GMAIL_REST") !== "0";
}

interface GmailPart extends GmailPartLike {}

interface GmailMessage {
  id?: string;
  threadId?: string;
  snippet?: string;
  labelIds?: string[];
  payload?: GmailPart;
}

function formatHeaderLine(name: string, value: string): string {
  const decoded = decodeMimeHeaderValue(value);
  return `${name}: ${decoded}`;
}

function formatSnippet(snippet: string | undefined): string {
  if (!snippet?.trim()) return "";
  return normalizeEmailWhitespace(decodeHtmlEntities(snippet));
}

async function gmailApiJson<T>(
  path: string,
  init?: RequestInit
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  if (!gmailRestEnabled()) {
    return { ok: false, error: "Gmail REST bridge is off (set AGENT_GOOGLE_GMAIL_REST=1)." };
  }
  const token = await getGoogleAccessToken();
  if (!token) {
    return {
      ok: false,
      error:
        "No Google OAuth token. Run `liminal connect google` or Settings → Integrations → Connect Google.",
    };
  }
  const url = path.startsWith("http") ? path : `${GMAIL_BASE}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers as Record<string, string> | undefined),
      },
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 400);
    try {
      const j = JSON.parse(text) as { error?: { message?: string } };
      if (j.error?.message) detail = j.error.message;
    } catch {
      /* use raw */
    }
    return { ok: false, error: `Gmail API HTTP ${res.status}: ${detail}` };
  }
  if (!text.trim()) return { ok: true, data: {} as T };
  try {
    return { ok: true, data: JSON.parse(text) as T };
  } catch {
    return { ok: false, error: "Gmail API returned non-JSON body" };
  }
}

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".ics": "text/calendar",
};

function mimeFromName(name: string): string {
  return MIME_BY_EXT[extname(name).toLowerCase()] ?? "application/octet-stream";
}

/** Load one inline-image / attachment spec (data URL, base64, or file path) into bytes. */
async function loadBlob(
  spec: Record<string, unknown>,
  kind: "inline" | "attachment"
): Promise<MimeBlob> {
  const mimeHint = typeof spec["mime_type"] === "string" ? (spec["mime_type"] as string).trim() : "";
  let filename = typeof spec["filename"] === "string" ? (spec["filename"] as string).trim() : "";
  let data: Buffer;
  let mimeType = mimeHint;

  const dataField = typeof spec["data_base64"] === "string" ? (spec["data_base64"] as string).trim() : "";
  const path = typeof spec["path"] === "string" ? (spec["path"] as string).trim() : "";

  if (dataField) {
    const dataUrl = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataField);
    if (dataUrl) {
      mimeType = mimeType || dataUrl[1] || "";
      data = Buffer.from(dataUrl[3] ?? "", dataUrl[2] ? "base64" : "utf8");
    } else {
      data = Buffer.from(dataField, "base64");
    }
  } else if (path) {
    data = await readFile(path);
    if (!filename && kind === "attachment") filename = basename(path);
    if (!mimeType) mimeType = mimeFromName(filename || path);
  } else {
    throw new Error(`${kind} item needs "path" or "data_base64"`);
  }
  if (!mimeType) mimeType = kind === "inline" ? "image/png" : "application/octet-stream";

  const blob: MimeBlob = { data, mimeType };
  if (kind === "attachment") blob.filename = filename || "attachment";
  else {
    const cid = typeof spec["content_id"] === "string" ? (spec["content_id"] as string).trim() : "";
    if (!cid) throw new Error('inline image needs "content_id" (referenced in HTML as cid:<id>)');
    blob.contentId = cid;
    if (filename) blob.filename = filename;
  }
  return blob;
}

function strArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((x) => String(x).trim()).filter(Boolean) : [];
}

interface ComposeArgs {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text?: string;
  html?: string;
  inlineImages?: MimeBlob[];
  attachments?: MimeBlob[];
  inReplyTo?: string;
}

/** Validate + load the shared compose fields used by draft + send. */
async function resolveComposeArgs(
  args: Record<string, unknown>
): Promise<{ ok: true; value: ComposeArgs } | { ok: false; error: string }> {
  const to = strArray(args["to"]);
  if (to.length === 0) return { ok: false, error: "to must include at least one address" };

  const body = typeof args["body"] === "string" ? (args["body"] as string) : "";
  const html = typeof args["body_html"] === "string" ? (args["body_html"] as string) : "";
  if (!body.trim() && !html.trim()) {
    return { ok: false, error: "provide body (plain text) and/or body_html (rich HTML)" };
  }

  let inlineImages: MimeBlob[] | undefined;
  let attachments: MimeBlob[] | undefined;
  try {
    if (Array.isArray(args["inline_images"])) {
      inlineImages = await Promise.all(
        (args["inline_images"] as Record<string, unknown>[]).map((s) => loadBlob(s, "inline"))
      );
    }
    if (Array.isArray(args["attachments"])) {
      attachments = await Promise.all(
        (args["attachments"] as Record<string, unknown>[]).map((s) => loadBlob(s, "attachment"))
      );
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  const value: ComposeArgs = { to, subject: String(args["subject"] ?? "").trim() };
  const cc = strArray(args["cc"]);
  const bcc = strArray(args["bcc"]);
  if (cc.length) value.cc = cc;
  if (bcc.length) value.bcc = bcc;
  if (body) value.text = body;
  if (html.trim()) value.html = html;
  if (inlineImages?.length) value.inlineImages = inlineImages;
  if (attachments?.length) value.attachments = attachments;
  if (typeof args["reply_to_message_id"] === "string") value.inReplyTo = args["reply_to_message_id"];
  return { ok: true, value };
}

/** JSON-schema fragment shared by draft + send (rich-email compose surface). */
const composeProperties: Record<string, PropertySchema> = {
  to: { type: "array", items: { type: "string" }, description: "Recipient email addresses." },
  cc: { type: "array", items: { type: "string" }, description: "Optional CC addresses." },
  bcc: { type: "array", items: { type: "string" }, description: "Optional BCC addresses." },
  subject: { type: "string", description: "Email subject." },
  body: {
    type: "string",
    description:
      "Plain-text body. Always provide this; it is the fallback shown when a client can't render HTML. " +
      "If omitted but body_html is set, a plain-text version is auto-derived.",
  },
  body_html: {
    type: "string",
    description:
      "Optional rich HTML body — author it freely to match the occasion (greeting cards, " +
      "announcements, newsletters). EMAIL-SAFE HTML ONLY: inline style= attributes (no <style> " +
      "blocks or external CSS), <table> for layout (no fl/grid), web-safe or stack fonts, absolute " +
      "image sizes. Reference inline images as <img src=\"cid:<content_id>\">. Omit for a plain email.",
  },
  inline_images: {
    type: "array",
    description:
      "Images embedded in the HTML body via cid: references (e.g. a card illustration). " +
      "Each: { content_id, path | data_base64, mime_type? }. content_id maps to src=\"cid:<id>\".",
    items: {
      type: "object",
      properties: {
        content_id: { type: "string", description: "ID referenced in HTML as cid:<id>." },
        path: { type: "string", description: "Local file path to the image." },
        data_base64: { type: "string", description: "Base64 (or data: URL) image bytes instead of a path." },
        mime_type: { type: "string", description: "e.g. image/png (inferred from path if omitted)." },
      },
      required: ["content_id"],
    },
  },
  attachments: {
    type: "array",
    description: "File attachments. Each: { path | data_base64, filename?, mime_type? }.",
    items: {
      type: "object",
      properties: {
        path: { type: "string", description: "Local file path to attach." },
        filename: { type: "string", description: "Display filename (defaults to the path basename)." },
        data_base64: { type: "string", description: "Base64 (or data: URL) bytes instead of a path." },
        mime_type: { type: "string", description: "Inferred from filename/path if omitted." },
      },
    },
  },
  reply_to_message_id: {
    type: "string",
    description: "Optional Message-ID header value for threading (from gmail_api_get_message headers).",
  },
};

export function createGmailApiTools(): ToolDefinition[] {
  // When transport=rest these ARE the Gmail tools (the preview MCP is not
  // attached); otherwise they are the fallback for when mcp_google_gmail_* 403s.
  const restPrimary = resolveGoogleGmailTransport() === "rest";
  const primaryNote = restPrimary
    ? "These are the PRIMARY Gmail tools (classic gmail.googleapis.com REST; no Workspace MCP preview needed)."
    : "Fallback for Gmail when the preview mcp_google_gmail_* tools return permission/400 errors (not enrolled in the MCP preview, or the *mcp* API is disabled).";

  const gmailApiListLabels = defineTool({
    name: "gmail_api_list_labels",
    description:
      "WHAT: List Gmail labels (classic Gmail API — works without Google MCP preview).\n" +
      "WHEN: Need label IDs before labeling, or to verify Gmail OAuth.\n" +
      primaryNote,
    parameters: { type: "object", properties: {}, additionalProperties: false },
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 60_000,
    handler: async (): Promise<ToolResult> => {
      const res = await gmailApiJson<{ labels?: Array<{ id?: string; name?: string; type?: string }> }>(
        "/labels"
      );
      if (!res.ok) return { ok: false, error: res.error };
      const labels = (res.data.labels ?? []).map((l) => `${l.id}\t${l.name ?? ""}\t${l.type ?? ""}`);
      return { ok: true, output: labels.length ? labels.join("\n") : "(no labels)" };
    },
  });

  const gmailApiSearchThreads = defineTool({
    name: "gmail_api_search_threads",
    description:
      "WHAT: Search Gmail threads via query (same syntax as Gmail search box).\n" +
      "WHEN: Find emails by sender, subject, date, is:unread, has:attachment, etc.\n" +
      "Uses gmail.googleapis.com (not preview MCP). " +
      primaryNote,
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: 'Gmail search query, e.g. "from:alice@example.com newer_than:7d is:unread".',
        },
        max_results: {
          type: "number",
          description: "Max threads (1–50, default 10).",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 30_000,
    handler: async (args): Promise<ToolResult> => {
      const q = String(args["query"] ?? "").trim();
      if (!q) return { ok: false, error: "query is required" };
      const max = Math.max(1, Math.min(50, Math.round(Number(args["max_results"]) || 10)));
      const params = new URLSearchParams({ q, maxResults: String(max) });
      const res = await gmailApiJson<{
        threads?: Array<{ id?: string; snippet?: string }>;
        resultSizeEstimate?: number;
      }>(`/threads?${params}`);
      if (!res.ok) return { ok: false, error: res.error };
      const threads = res.data.threads ?? [];
      if (threads.length === 0) {
        return { ok: true, output: `No threads matched (estimate ${res.data.resultSizeEstimate ?? 0}).` };
      }
      const lines = threads.map((t) => `threadId=${t.id}\t${(t.snippet ?? "").replace(/\s+/g, " ").slice(0, 200)}`);
      return { ok: true, output: lines.join("\n") };
    },
  });

  const gmailApiGetMessage = defineTool({
    name: "gmail_api_get_message",
    description:
      "WHAT: Fetch one Gmail message by ID (headers, snippet, plain body when available).\n" +
      "WHEN: You have a messageId from gmail_api_search_threads or a thread listing.",
    parameters: {
      type: "object",
      properties: {
        message_id: { type: "string", description: "Gmail message ID." },
        format: {
          type: "string",
          enum: ["metadata", "full"],
          description: "metadata = headers/snippet only; full = include decoded body (default full).",
        },
      },
      required: ["message_id"],
      additionalProperties: false,
    },
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 60_000,
    handler: async (args): Promise<ToolResult> => {
      const messageId = String(args["message_id"] ?? "").trim();
      if (!messageId) return { ok: false, error: "message_id is required" };
      const format = args["format"] === "metadata" ? "metadata" : "full";
      const res = await gmailApiJson<GmailMessage>(
        `/messages/${encodeURIComponent(messageId)}?format=${format}`
      );
      if (!res.ok) return { ok: false, error: res.error };
      const m = res.data;
      const headerLines: string[] = [];
      const hdrs = m.payload?.headers as Array<{ name?: string; value?: string }> | undefined;
      for (const h of hdrs ?? []) {
        if (h.name && h.value) headerLines.push(formatHeaderLine(h.name, h.value));
      }
      const body = format === "full" ? extractEmailBody(m.payload).slice(0, 32_000) : "";
      const out = [
        `id: ${m.id}`,
        `threadId: ${m.threadId}`,
        `snippet: ${formatSnippet(m.snippet)}`,
        ...(headerLines.length ? ["", ...headerLines] : []),
        ...(body ? ["", "--- body ---", body] : []),
      ].join("\n");
      return { ok: true, output: out };
    },
  });

  const gmailApiListThreadMessages = defineTool({
    name: "gmail_api_get_thread",
    description:
      "WHAT: Get a thread with message IDs and snippets (classic Gmail API).\n" +
      "WHEN: You have a threadId from gmail_api_search_threads.",
    parameters: {
      type: "object",
      properties: {
        thread_id: { type: "string", description: "Gmail thread ID." },
        format: {
          type: "string",
          enum: ["metadata", "full"],
          description: "Per-message format (default metadata).",
        },
      },
      required: ["thread_id"],
      additionalProperties: false,
    },
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 30_000,
    handler: async (args): Promise<ToolResult> => {
      const threadId = String(args["thread_id"] ?? "").trim();
      if (!threadId) return { ok: false, error: "thread_id is required" };
      const format = args["format"] === "full" ? "full" : "metadata";
      const res = await gmailApiJson<{ id?: string; messages?: GmailMessage[] }>(
        `/threads/${encodeURIComponent(threadId)}?format=${format}`
      );
      if (!res.ok) return { ok: false, error: res.error };
      const msgs = res.data.messages ?? [];
      const lines = msgs.map((m) => {
        const subjRaw = m.payload?.headers?.find((h) => h.name?.toLowerCase() === "subject")?.value;
        const subj = subjRaw ? decodeMimeHeaderValue(subjRaw) : "?";
        const snip = formatSnippet(m.snippet).replace(/\s+/g, " ").slice(0, 120);
        return `messageId=${m.id}\tsubject=${subj}\t${snip}`;
      });
      return {
        ok: true,
        output: `threadId=${res.data.id}\n${lines.join("\n") || "(empty thread)"}`,
      };
    },
  });

  const gmailApiCreateDraft = defineTool({
    name: "gmail_api_create_draft",
    description:
      "WHAT: Create a Gmail draft — plain OR fully styled HTML (greeting cards, announcements, newsletters) with inline images and attachments (classic API; gmail.compose scope).\n" +
      "WHEN: User wants a draft to review in Gmail before sending.\n" +
      "STYLE: default plain (body only). For occasions/celebrations or when the user asks for something designed, add body_html. See the Email composition protocol for the artistic-vs-plain rubric and email-safe HTML rules.",
    parameters: {
      type: "object",
      properties: composeProperties,
      required: ["to", "subject"],
      additionalProperties: false,
    },
    requiresApproval: true,
    dangerLevel: "destructive",
    handler: async (args): Promise<ToolResult> => {
      const resolved = await resolveComposeArgs(args);
      if (!resolved.ok) return { ok: false, error: resolved.error };
      const raw = buildMimeMessage(resolved.value);
      const res = await gmailApiJson<{ id?: string; message?: { id?: string; threadId?: string } }>("/drafts", {
        method: "POST",
        body: JSON.stringify({ message: { raw } }),
      });
      if (!res.ok) return { ok: false, error: res.error };
      return {
        ok: true,
        output: `Draft created. draftId=${res.data.id ?? "?"}, messageId=${res.data.message?.id ?? "?"}, threadId=${res.data.message?.threadId ?? "?"}`,
      };
    },
  });

  const gmailApiSendMessage = defineTool({
    name: "gmail_api_send_message",
    description:
      "WHAT: Send an email immediately via Gmail — plain OR fully styled HTML with inline images/attachments (classic API; gmail.compose scope permits send).\n" +
      "WHEN: User explicitly asked to SEND (not just draft). Approval-gated: the recipient receives it on approval.\n" +
      "STYLE: same compose surface as gmail_api_create_draft — default plain; add body_html for designed/celebratory emails per the Email composition protocol.\n" +
      "SAFETY: double-check recipients before approving; this delivers real mail. Prefer a draft when the user only wants to review.",
    parameters: {
      type: "object",
      properties: composeProperties,
      required: ["to", "subject"],
      additionalProperties: false,
    },
    requiresApproval: true,
    dangerLevel: "destructive",
    handler: async (args): Promise<ToolResult> => {
      const resolved = await resolveComposeArgs(args);
      if (!resolved.ok) return { ok: false, error: resolved.error };
      const raw = buildMimeMessage(resolved.value);
      const res = await gmailApiJson<{ id?: string; threadId?: string; labelIds?: string[] }>("/messages/send", {
        method: "POST",
        body: JSON.stringify({ raw }),
      });
      if (!res.ok) return { ok: false, error: res.error };
      const v = resolved.value;
      const recip = [...v.to, ...(v.cc ?? []), ...(v.bcc ?? [])].join(", ");
      return {
        ok: true,
        output: `Email sent to ${recip}. messageId=${res.data.id ?? "?"}, threadId=${res.data.threadId ?? "?"}`,
      };
    },
  });

  return [
    gmailApiListLabels,
    gmailApiSearchThreads,
    gmailApiGetMessage,
    gmailApiListThreadMessages,
    gmailApiCreateDraft,
    gmailApiSendMessage,
  ];
}
