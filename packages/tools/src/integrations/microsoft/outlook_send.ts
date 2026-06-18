/**
 * Outlook send/draft via Microsoft Graph — HTML body, attachments, reply threading.
 */
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import type { PropertySchema, ToolDefinition, ToolResult } from "@liminal/core";
import {
  listMicrosoftMailOAuthAccounts,
  resolveMicrosoftMailAccount,
  resolvePreferredMailProvider,
  validateOutboundEmailRecipients,
} from "@liminal/core";
import { validateOutboundEmailStyle } from "../google/gmail_compose_guard.js";
import { defineTool } from "../../shared/helpers.js";
import { graphApiJson, graphJsonResult, graphErrorResult, microsoftRestEnabled } from "./graph_rest.js";
import { humanizeOutboundEmailCopy, repairEmailUnicode } from "../google/gmail_message_body.js";

export function outlookRestEnabled(): boolean {
  return microsoftRestEnabled();
}

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function mimeFromName(name: string): string {
  return MIME_BY_EXT[extname(name).toLowerCase()] ?? "application/octet-stream";
}

async function loadAttachment(spec: Record<string, unknown>): Promise<{
  name: string;
  contentType: string;
  contentBytes: string;
}> {
  const dataField =
    typeof spec["data_base64"] === "string" ? (spec["data_base64"] as string).trim() : "";
  const filePath = typeof spec["path"] === "string" ? (spec["path"] as string).trim() : "";
  let filename = typeof spec["filename"] === "string" ? (spec["filename"] as string).trim() : "";
  let buf: Buffer;
  if (dataField) {
    const raw = dataField.replace(/^data:[^;]+;base64,/, "");
    buf = Buffer.from(raw, "base64");
  } else if (filePath) {
    buf = await readFile(filePath);
    if (!filename) filename = basename(filePath);
  } else {
    throw new Error("attachment needs data_base64 or path");
  }
  if (!filename) filename = "attachment";
  const mimeType =
    (typeof spec["mime_type"] === "string" ? spec["mime_type"] : "") || mimeFromName(filename);
  return {
    name: filename,
    contentType: mimeType,
    contentBytes: buf.toString("base64"),
  };
}

function parseRecipients(raw: unknown): Array<{ emailAddress: { address: string } }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => {
      if (typeof r === "string") return { emailAddress: { address: r.trim() } };
      if (r && typeof r === "object" && typeof (r as { email?: string }).email === "string") {
        return { emailAddress: { address: (r as { email: string }).email.trim() } };
      }
      return null;
    })
    .filter((x): x is { emailAddress: { address: string } } => !!x?.emailAddress.address);
}

function buildMessageBody(args: Record<string, unknown>): Record<string, unknown> {
  const subject = humanizeOutboundEmailCopy(
    repairEmailUnicode(String(args["subject"] ?? "").trim())
  );
  const html = humanizeOutboundEmailCopy(
    repairEmailUnicode(String(args["body_html"] ?? args["html"] ?? "").trim())
  );
  const text = humanizeOutboundEmailCopy(
    repairEmailUnicode(String(args["body_text"] ?? args["body"] ?? "").trim())
  );
  const to = parseRecipients(args["to"]);
  const cc = parseRecipients(args["cc"]);
  const bcc = parseRecipients(args["bcc"]);

  const message: Record<string, unknown> = {
    subject,
    body: {
      contentType: html ? "HTML" : "Text",
      content: html || text,
    },
    toRecipients: to,
  };
  if (cc.length) message.ccRecipients = cc;
  if (bcc.length) message.bccRecipients = bcc;
  return message;
}

async function buildAttachments(
  args: Record<string, unknown>
): Promise<Array<Record<string, unknown>>> {
  const raw = args["attachments"];
  if (!Array.isArray(raw)) return [];
  const out: Array<Record<string, unknown>> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const att = await loadAttachment(item as Record<string, unknown>);
    out.push({
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: att.name,
      contentType: att.contentType,
      contentBytes: att.contentBytes,
    });
  }
  return out;
}

const sendParams: Record<string, PropertySchema> = {
  to: {
    type: "array",
    items: { type: "string" },
    description: "Recipient email addresses.",
  },
  cc: { type: "array", items: { type: "string" } },
  bcc: { type: "array", items: { type: "string" } },
  subject: { type: "string" },
  body_html: {
    type: "string",
    description:
      "**Required for new outbound mail** (with body_text). HTML body — inline styles, nested tables. " +
      "Include on the **first** outlook_create_draft call. No em/en dashes or &mdash; (R-EMAIL-COPY).",
  },
  body_text: {
    type: "string",
    description:
      "**Required alongside body_html** for new outbound mail. Plain fallback. " +
      "PLAIN-tier only: thread replies and one-liners may omit body_html. No em/en dashes (R-EMAIL-COPY).",
  },
  attachments: {
    type: "array",
    items: { type: "object" },
    description: "Each: { path } or { data_base64, filename?, mime_type? }.",
  },
  save_to_sent_items: { type: "boolean" },
  reply_to_message_id: {
    type: "string",
    description: "Graph message id to reply to (sets conversation threading).",
  },
  mailbox: {
    type: "string",
    description: "Optional shared mailbox user id or UPN (default: /me).",
  },
  account_hint: {
    type: "string",
    description:
      "Sending mailbox email or account id. Required when multiple Microsoft accounts are connected — use the account that received the thread.",
  },
};

function mailboxBase(args: Record<string, unknown>): string {
  const mb = String(args["mailbox"] ?? "").trim();
  return mb ? `/users/${encodeURIComponent(mb)}` : "/me";
}

async function resolveOutlookAccountId(
  args: Record<string, unknown>
): Promise<{ accountId: string; email?: string } | { error: string }> {
  const hint = typeof args["account_hint"] === "string" ? args["account_hint"].trim() : undefined;
  const accounts = await listMicrosoftMailOAuthAccounts();
  const resolved = resolveMicrosoftMailAccount(hint, accounts);
  if ("error" in resolved) return resolved;
  return { accountId: resolved.account.accountId, email: resolved.account.email };
}

async function outlookMailRouteBlocked(
  args: Record<string, unknown>
): Promise<ToolResult | null> {
  if (String(args["mailbox"] ?? "").trim()) return null;
  const mailRoute = await resolvePreferredMailProvider();
  if (mailRoute?.provider !== "google") return null;
  return graphErrorResult(
    `Primary mail is Gmail (${mailRoute.email ?? mailRoute.accountId}). ` +
      "Use gmail_send_message / mcp_google_gmail_* — not Outlook. " +
      "Pass mailbox for a shared Outlook mailbox, or set AGENT_MAIL_PROVIDER=microsoft."
  );
}

export function createOutlookSendTools(): ToolDefinition[] {
  const sendTool = defineTool({
    name: "outlook_send_message",
    description:
      "Send an Outlook email immediately via Microsoft Graph with HTML body and optional attachments.",
    parameters: {
      type: "object",
      properties: sendParams,
      required: ["to", "subject"],
      additionalProperties: false,
    },
    requiresApproval: true,
    handler: async (args): Promise<ToolResult> => {
      if (!outlookRestEnabled()) {
        return graphErrorResult("Outlook REST is off (set AGENT_MICROSOFT_REST=1).");
      }
      const recipErr = validateOutboundEmailRecipients(args, "send");
      if (recipErr) return { ok: false, error: recipErr };
      const styleErr = validateOutboundEmailStyle(args);
      if (styleErr) return graphErrorResult(styleErr);
      const blocked = await outlookMailRouteBlocked(args);
      if (blocked) return blocked;
      const acct = await resolveOutlookAccountId(args);
      if ("error" in acct) return graphErrorResult(acct.error);
      const message = buildMessageBody(args);
      const attachments = await buildAttachments(args);
      if (attachments.length) message.attachments = attachments;

      const replyId = String(args["reply_to_message_id"] ?? "").trim();
      const base = mailboxBase(args);

      if (replyId) {
        const replyBody = {
          message: {
            ...message,
            toRecipients: message.toRecipients,
          },
          comment: "",
        };
        const result = await graphApiJson(`${base}/messages/${encodeURIComponent(replyId)}/reply`, {
          method: "POST",
          body: JSON.stringify(replyBody),
          accountId: acct.accountId,
        });
        if (!result.ok) return graphErrorResult(result.error);
        const fromLabel = acct.email ?? acct.accountId;
        return { ok: true, output: `Reply sent from ${fromLabel} for message ${replyId}. fromAccount=${fromLabel}` };
      }

      const payload = {
        message,
        saveToSentItems: args["save_to_sent_items"] !== false,
      };
      const result = await graphApiJson(`${base}/sendMail`, {
        method: "POST",
        body: JSON.stringify(payload),
        accountId: acct.accountId,
      });
      if (!result.ok) return graphErrorResult(result.error);
      const fromLabel = acct.email ?? acct.accountId;
      return { ok: true, output: `Message sent via Outlook from ${fromLabel}. fromAccount=${fromLabel}` };
    },
  });

  const sendDraftTool = defineTool({
    name: "outlook_send_draft",
    description:
      "Send an existing Outlook draft via Graph (POST /messages/{id}/send). " +
      "Use message_id from outlook_create_draft — do not recompose via outlook_send_message unless the user asked to rewrite.",
    parameters: {
      type: "object",
      properties: {
        message_id: {
          type: "string",
          description: "Graph message id returned by outlook_create_draft.",
        },
        mailbox: sendParams.mailbox,
        account_hint: sendParams.account_hint,
      },
      required: ["message_id"],
      additionalProperties: false,
    },
    requiresApproval: true,
    handler: async (args): Promise<ToolResult> => {
      if (!outlookRestEnabled()) {
        return graphErrorResult("Outlook REST is off (set AGENT_MICROSOFT_REST=1).");
      }
      const blocked = await outlookMailRouteBlocked(args);
      if (blocked) return blocked;
      const messageId = String(args["message_id"] ?? "").trim();
      if (!messageId) return graphErrorResult("message_id is required");
      const acct = await resolveOutlookAccountId(args);
      if ("error" in acct) return graphErrorResult(acct.error);
      const result = await graphApiJson(
        `${mailboxBase(args)}/messages/${encodeURIComponent(messageId)}/send`,
        { method: "POST", accountId: acct.accountId }
      );
      if (!result.ok) return graphErrorResult(result.error);
      const fromLabel = acct.email ?? acct.accountId;
      return { ok: true, output: `Outlook draft sent from ${fromLabel}. messageId=${messageId}, fromAccount=${fromLabel}` };
    },
  });

  const draftTool = defineTool({
    name: "outlook_create_draft",
    description:
      "Create an Outlook draft message (does not send). **First call** must include body_html + body_text together for new outbound mail. " +
      "To deliver later, use outlook_send_draft(message_id) — not outlook_send_message with a recomposed body.",
    parameters: {
      type: "object",
      properties: sendParams,
      required: ["subject"],
      additionalProperties: false,
    },
    requiresApproval: false,
    intentDedupArgs: ["to", "subject"],
    intentPayloadComplete: (args, output) => {
      if (!/messageId=[^\s?,]+/i.test(output)) return false;
      return (
        validateOutboundEmailRecipients(args, "draft") === null &&
        validateOutboundEmailStyle(args) === null
      );
    },
    handler: async (args): Promise<ToolResult> => {
      if (!outlookRestEnabled()) {
        return graphErrorResult("Outlook REST is off (set AGENT_MICROSOFT_REST=1).");
      }
      const recipErr = validateOutboundEmailRecipients(args, "draft");
      if (recipErr) return { ok: false, error: recipErr };
      const styleErr = validateOutboundEmailStyle(args);
      if (styleErr) return graphErrorResult(styleErr);
      const blocked = await outlookMailRouteBlocked(args);
      if (blocked) return blocked;
      const acct = await resolveOutlookAccountId(args);
      if ("error" in acct) return graphErrorResult(acct.error);
      const message = buildMessageBody(args);
      const attachments = await buildAttachments(args);
      if (attachments.length) message.attachments = attachments;
      const result = await graphApiJson(`${mailboxBase(args)}/messages`, {
        method: "POST",
        body: JSON.stringify(message),
        accountId: acct.accountId,
      });
      if (!result.ok) return graphErrorResult(result.error);
      const data = result.data as { id?: string };
      const id = typeof data?.id === "string" ? data.id : "";
      const fromLabel = acct.email ?? acct.accountId;
      return {
        ok: true,
        output: id
          ? `Outlook draft created from ${fromLabel}. messageId=${id} (use outlook_send_draft to send). fromAccount=${fromLabel}`
          : JSON.stringify(result.data),
      };
    },
  });

  return [sendTool, sendDraftTool, draftTool];
}
