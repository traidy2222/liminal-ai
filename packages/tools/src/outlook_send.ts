/**
 * Outlook send/draft via Microsoft Graph — HTML body, attachments, reply threading.
 */
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import type { PropertySchema, ToolDefinition, ToolResult } from "@liminal/core";
import { resolvePreferredMailProvider } from "@liminal/core";
import { defineTool } from "./helpers.js";
import { graphApiJson, graphJsonResult, graphErrorResult, microsoftRestEnabled } from "./graph_rest.js";
import { humanizeOutboundEmailCopy, repairEmailUnicode } from "./gmail_message_body.js";

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
    description: "HTML body (preferred). No em/en dashes or &mdash; in copy (R-EMAIL-COPY).",
  },
  body_text: {
    type: "string",
    description: "Plain text fallback. No em/en dashes in copy (R-EMAIL-COPY).",
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
};

function mailboxBase(args: Record<string, unknown>): string {
  const mb = String(args["mailbox"] ?? "").trim();
  return mb ? `/users/${encodeURIComponent(mb)}` : "/me";
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
      const blocked = await outlookMailRouteBlocked(args);
      if (blocked) return blocked;
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
        });
        if (!result.ok) return graphErrorResult(result.error);
        return { ok: true, output: `Reply sent for message ${replyId}.` };
      }

      const payload = {
        message,
        saveToSentItems: args["save_to_sent_items"] !== false,
      };
      const result = await graphApiJson(`${base}/sendMail`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (!result.ok) return graphErrorResult(result.error);
      return { ok: true, output: "Message sent via Outlook." };
    },
  });

  const draftTool = defineTool({
    name: "outlook_create_draft",
    description: "Create an Outlook draft message (does not send).",
    parameters: {
      type: "object",
      properties: sendParams,
      required: ["subject"],
      additionalProperties: false,
    },
    requiresApproval: false,
    handler: async (args): Promise<ToolResult> => {
      if (!outlookRestEnabled()) {
        return graphErrorResult("Outlook REST is off (set AGENT_MICROSOFT_REST=1).");
      }
      const blocked = await outlookMailRouteBlocked(args);
      if (blocked) return blocked;
      const message = buildMessageBody(args);
      const attachments = await buildAttachments(args);
      if (attachments.length) message.attachments = attachments;
      const result = await graphApiJson(`${mailboxBase(args)}/messages`, {
        method: "POST",
        body: JSON.stringify(message),
      });
      if (!result.ok) return graphErrorResult(result.error);
      return graphJsonResult(result.data);
    },
  });

  return [sendTool, draftTool];
}
