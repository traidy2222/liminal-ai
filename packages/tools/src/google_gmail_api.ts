/**
 * Gmail via classic REST API (gmail.googleapis.com) — works without Workspace MCP preview.
 * Uses the same OAuth token as connect google / Integrations.
 */
import { effectiveHarnessEnvRaw, getGoogleAccessToken, resolveGoogleGmailTransport } from "@liminal/core";
import type { ToolDefinition, ToolResult } from "@liminal/core";
import { defineTool } from "./helpers.js";
import {
  decodeHtmlEntities,
  decodeMimeHeaderValue,
  encodeRfc822HeaderValue,
  extractEmailBody,
  normalizeEmailWhitespace,
  type GmailPartLike,
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

function buildRfc822Raw(opts: {
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  inReplyTo?: string;
}): string {
  const lines = [
    `To: ${opts.to.join(", ")}`,
    ...(opts.cc?.length ? [`Cc: ${opts.cc.join(", ")}`] : []),
    `Subject: ${encodeRfc822HeaderValue(opts.subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
  ];
  if (opts.inReplyTo?.trim()) {
    lines.push(`In-Reply-To: ${opts.inReplyTo.trim()}`);
    lines.push(`References: ${opts.inReplyTo.trim()}`);
  }
  const raw = `${lines.join("\r\n")}\r\n\r\n${opts.body}`;
  return Buffer.from(raw, "utf8").toString("base64url");
}

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
      "WHAT: Create a Gmail draft (classic API; needs gmail.compose scope).\n" +
      "WHEN: User wants a draft to review in Gmail before sending.\n" +
      "NOT WHEN: User asked to send immediately — Gmail API send needs extra scope; user sends from Gmail UI.",
    parameters: {
      type: "object",
      properties: {
        to: {
          type: "array",
          items: { type: "string" },
          description: "Recipient email addresses.",
        },
        cc: {
          type: "array",
          items: { type: "string" },
          description: "Optional CC addresses.",
        },
        subject: { type: "string", description: "Email subject." },
        body: { type: "string", description: "Plain-text body." },
        reply_to_message_id: {
          type: "string",
          description: "Optional Message-ID header value for threading (from gmail_api_get_message headers).",
        },
      },
      required: ["to", "subject", "body"],
      additionalProperties: false,
    },
    requiresApproval: true,
    dangerLevel: "destructive",
    handler: async (args): Promise<ToolResult> => {
      const to = Array.isArray(args["to"])
        ? (args["to"] as unknown[]).map((x) => String(x).trim()).filter(Boolean)
        : [];
      if (to.length === 0) return { ok: false, error: "to must include at least one address" };
      const cc = Array.isArray(args["cc"])
        ? (args["cc"] as unknown[]).map((x) => String(x).trim()).filter(Boolean)
        : undefined;
      const subject = String(args["subject"] ?? "").trim();
      const body = String(args["body"] ?? "");
      const raw = buildRfc822Raw({
        to,
        cc,
        subject,
        body,
        inReplyTo: typeof args["reply_to_message_id"] === "string" ? args["reply_to_message_id"] : undefined,
      });
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

  return [
    gmailApiListLabels,
    gmailApiSearchThreads,
    gmailApiGetMessage,
    gmailApiListThreadMessages,
    gmailApiCreateDraft,
  ];
}
