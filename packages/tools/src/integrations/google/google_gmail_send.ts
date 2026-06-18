/**
 * Gmail immediate send via classic REST (gmail.googleapis.com).
 * Read/search/draft/label use official mcp_google_gmail_*; this tool covers users.messages.send only.
 */
import { effectiveHarnessEnvRaw, getGoogleAccessToken, listGoogleMailOAuthAccounts, resolveGoogleMailAccount } from "@liminal/core";
import type { PropertySchema, ToolDefinition, ToolResult } from "@liminal/core";
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { defineTool } from "../../shared/helpers.js";
import { validateOutboundEmailStyle } from "./gmail_compose_guard.js";
import { validateOutboundEmailRecipients } from "@liminal/core";
import { buildMimeMessage, type MimeBlob } from "./gmail_message_body.js";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

export function gmailSendRestEnabled(): boolean {
  return effectiveHarnessEnvRaw("AGENT_GOOGLE_GMAIL_SEND") !== "0";
}

async function gmailApiJson<T>(
  path: string,
  accountId: string,
  init?: RequestInit
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  if (!gmailSendRestEnabled()) {
    return { ok: false, error: "Gmail REST send is off (set AGENT_GOOGLE_GMAIL_SEND=1)." };
  }
  const token = await getGoogleAccessToken(accountId);
  if (!token) {
    return {
      ok: false,
      error:
        "No Google OAuth token. Run `liminal connect google --attach` or Settings → Integrations → Connect Google.",
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
  threadId?: string;
}

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
  const threadId =
    typeof args["thread_id"] === "string"
      ? (args["thread_id"] as string).trim()
      : typeof args["threadId"] === "string"
        ? (args["threadId"] as string).trim()
        : "";
  if (threadId) value.threadId = threadId;
  return { ok: true, value };
}

async function resolveGmailAccountForArgs(
  args: Record<string, unknown>
): Promise<{ accountId: string; email?: string } | { error: string }> {
  const hint = typeof args["account_hint"] === "string" ? args["account_hint"].trim() : undefined;
  const accounts = await listGoogleMailOAuthAccounts();
  const resolved = resolveGoogleMailAccount(hint, accounts);
  if ("error" in resolved) return resolved;
  return { accountId: resolved.account.accountId, email: resolved.account.email };
}

const composeProperties: Record<string, PropertySchema> = {
  to: { type: "array", items: { type: "string" }, description: "Recipient email addresses." },
  cc: { type: "array", items: { type: "string" }, description: "Optional CC addresses." },
  bcc: { type: "array", items: { type: "string" }, description: "Optional BCC addresses." },
  subject: { type: "string", description: "Email subject." },
  body_html: {
    type: "string",
    description:
      "The finished HTML email (required for new outbound mail, with body). Nested tables + inline styles. " +
      "Compose this fully before calling the tool — it is the deliverable, not a later upgrade.",
  },
  body: {
    type: "string",
    description:
      "Plain-text fallback (required alongside body_html for new outbound mail). " +
      "Thread replies and one-liners may omit body_html and use body alone.",
  },
  inline_images: {
    type: "array",
    description:
      "Images embedded in the HTML body via cid: references. Each: { content_id, path | data_base64, mime_type? }.",
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
    description: "Optional Message-ID header for threading (from mcp_google_gmail_get_thread or message headers).",
  },
  thread_id: {
    type: "string",
    description: "Optional Gmail thread id when drafting/replying in an existing conversation.",
  },
  account_hint: {
    type: "string",
    description:
      "Mailbox email or account id to send from. **Required when multiple Gmail accounts are connected** — use the account that received the thread (see mail_search_inboxes / inbox triage).",
  },
};

const composeParameters = {
  type: "object" as const,
  properties: composeProperties,
  required: ["to", "subject"] as string[],
  additionalProperties: false as const,
};

/** REST Gmail compose tools — registered when AGENT_GOOGLE_GMAIL_SEND is on (default). */
export function createGmailSendTools(): ToolDefinition[] {
  const gmailCreateDraft = defineTool({
    name: "gmail_create_draft",
    description:
      "WHAT: Create a Gmail draft (users.drafts.create) — this call **is** the finished styled email.\n" +
      "WHEN: Any new outbound mail the user wants drafted or reviewed in Gmail.\n" +
      "HOW: Plan subject + formatted body_html + plain body **before** calling. Pass all three in **one** invocation — body_html is the real email (nested tables, inline styles). Not mcp_google_gmail_create_draft (plain-only).\n" +
      "AFTER: gmail_send_draft(draftId) when the user approves send.\n" +
      "STYLE: Neutral professional body_html + body (R-EMAIL-STYLE). email_style_infer only if user named an industry/style this turn. Plain-only for thread replies.\n" +
      "SAFETY: approval-gated — verify recipients before approving.",
    parameters: composeParameters,
    requiresApproval: true,
    dangerLevel: "destructive",
    intentDedupArgs: ["to", "subject", "thread_id"],
    intentPayloadComplete: (args, output) =>
      /draftId=[^\s?,]+/i.test(output) &&
      validateOutboundEmailStyle(args) === null &&
      validateOutboundEmailRecipients(args, "draft") === null,
    handler: async (args): Promise<ToolResult> => {
      const recipErr = validateOutboundEmailRecipients(args, "draft");
      if (recipErr) return { ok: false, error: recipErr };
      const styleErr = validateOutboundEmailStyle(args);
      if (styleErr) return { ok: false, error: styleErr };
      const acct = await resolveGmailAccountForArgs(args);
      if ("error" in acct) return { ok: false, error: acct.error };
      const resolved = await resolveComposeArgs(args);
      if (!resolved.ok) return { ok: false, error: resolved.error };
      const raw = buildMimeMessage(resolved.value);
      const message: { raw: string; threadId?: string } = { raw };
      if (resolved.value.threadId) message.threadId = resolved.value.threadId;
      const res = await gmailApiJson<{ id?: string; message?: { id?: string; threadId?: string } }>(
        "/drafts",
        acct.accountId,
        { method: "POST", body: JSON.stringify({ message }) }
      );
      if (!res.ok) return { ok: false, error: res.error };
      const v = resolved.value;
      const recip = [...v.to, ...(v.cc ?? []), ...(v.bcc ?? [])].join(", ");
      const fromLabel = acct.email ?? acct.accountId;
      return {
        ok: true,
        output:
          `Draft created for ${recip} from ${fromLabel}. draftId=${res.data.id ?? "?"}, ` +
          `messageId=${res.data.message?.id ?? "?"}, threadId=${res.data.message?.threadId ?? "?"}, ` +
          `fromAccount=${fromLabel}`,
      };
    },
  });

  const gmailSendDraft = defineTool({
    name: "gmail_send_draft",
    description:
      "WHAT: Send an existing Gmail draft via REST (users.drafts.send) — no body recomposition.\n" +
      "WHEN: gmail_create_draft already succeeded and the user approved sending that draft (or said send the draft / send it).\n" +
      "HOW: Pass draft_id from the gmail_create_draft tool result. Do **not** call gmail_send_message with a full body for the same mail.\n" +
      "SAFETY: approval-gated — real mail leaves the account on approve.",
    parameters: {
      type: "object" as const,
      properties: {
        draft_id: {
          type: "string",
          description: "draftId returned by gmail_create_draft (e.g. from tool output draftId=…).",
        },
        account_hint: composeProperties.account_hint,
      },
      required: ["draft_id"] as string[],
      additionalProperties: false as const,
    },
    requiresApproval: true,
    dangerLevel: "destructive",
    handler: async (args): Promise<ToolResult> => {
      const draftId = String(args["draft_id"] ?? "").trim();
      if (!draftId) return { ok: false, error: "draft_id is required" };
      const acct = await resolveGmailAccountForArgs(args);
      if ("error" in acct) return { ok: false, error: acct.error };
      const res = await gmailApiJson<{ id?: string; threadId?: string; labelIds?: string[] }>(
        "/drafts/send",
        acct.accountId,
        { method: "POST", body: JSON.stringify({ id: draftId }) }
      );
      if (!res.ok) return { ok: false, error: res.error };
      const fromLabel = acct.email ?? acct.accountId;
      return {
        ok: true,
        output:
          `Draft sent from ${fromLabel}. draftId=${draftId}, messageId=${res.data.id ?? "?"}, ` +
          `threadId=${res.data.threadId ?? "?"}, fromAccount=${fromLabel}`,
      };
    },
  });

  const gmailSendMessage = defineTool({
    name: "gmail_send_message",
    description:
      "WHAT: Send email immediately via Gmail REST (users.messages.send). Same OAuth as Google Workspace MCP.\n" +
      "WHEN: **Thread reply only** — existing Gmail thread with thread_id or reply_to_message_id.\n" +
      "NOT FOR: Cold outreach, new mail, or bulk sends — use gmail_create_draft + gmail_send_draft (harness blocks cold gmail_send_message).\n" +
      "HOW: Prefer mcp_google_gmail_* for search/read/labels; gmail_create_draft + gmail_send_draft for draft-then-send.\n" +
      "STYLE: Neutral professional body_html + body (R-EMAIL-STYLE). email_style_infer only if user named an industry/style this turn. Plain-only for thread replies.\n" +
      "SAFETY: approval-gated — verify recipients; real mail leaves the account on approve.",
    parameters: composeParameters,
    requiresApproval: true,
    dangerLevel: "destructive",
    handler: async (args): Promise<ToolResult> => {
      const recipErr = validateOutboundEmailRecipients(args, "send");
      if (recipErr) return { ok: false, error: recipErr };
      const styleErr = validateOutboundEmailStyle(args);
      if (styleErr) return { ok: false, error: styleErr };
      const acct = await resolveGmailAccountForArgs(args);
      if ("error" in acct) return { ok: false, error: acct.error };
      const resolved = await resolveComposeArgs(args);
      if (!resolved.ok) return { ok: false, error: resolved.error };
      const raw = buildMimeMessage(resolved.value);
      const res = await gmailApiJson<{ id?: string; threadId?: string }>("/messages/send", acct.accountId, {
        method: "POST",
        body: JSON.stringify({ raw }),
      });
      if (!res.ok) return { ok: false, error: res.error };
      const v = resolved.value;
      const recip = [...v.to, ...(v.cc ?? []), ...(v.bcc ?? [])].join(", ");
      const fromLabel = acct.email ?? acct.accountId;
      return {
        ok: true,
        output:
          `Email sent from ${fromLabel} to ${recip}. messageId=${res.data.id ?? "?"}, ` +
          `threadId=${res.data.threadId ?? "?"}, fromAccount=${fromLabel}`,
      };
    },
  });

  return [gmailCreateDraft, gmailSendDraft, gmailSendMessage];
}
