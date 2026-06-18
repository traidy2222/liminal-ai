/**
 * Search inbox across all connected Gmail and Outlook accounts (multi-mailbox).
 */
import {
  listGoogleMailOAuthAccounts,
  listMicrosoftMailOAuthAccounts,
  matchMailAccountByHint,
  redactMailSearchToolOutput,
  type ToolDefinition,
  type ToolResult,
} from "@liminal/core";
import { defineTool } from "../../shared/helpers.js";
import { gmailJson, listGmailInboxAccounts } from "../google/gmail_inbox_poll.js";
import { graphApiJson } from "../microsoft/graph_rest.js";
import { listMicrosoftInboxAccounts } from "../microsoft/mail_inbox_poll.js";

const GMAIL_META_HEADERS = "From&metadataHeaders=Subject&metadataHeaders=Date";

interface GmailListMessage {
  id?: string;
  threadId?: string;
  snippet?: string;
  internalDate?: string;
  payload?: { headers?: Array<{ name?: string; value?: string }> };
}

function headerValue(
  headers: Array<{ name?: string; value?: string }> | undefined,
  name: string
): string {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value?.trim() ?? "";
}

function parseFrom(raw: string): { name: string; email: string } {
  const m = raw.match(/<([^>]+)>/);
  const email = m?.[1]?.trim() ?? raw.trim();
  const name = raw.replace(/<[^>]+>/, "").trim().replace(/^"|"$/g, "") || email;
  return { name, email };
}

async function searchGmailAccount(
  accountId: string,
  accountEmail: string | undefined,
  query: string,
  maxResults: number
): Promise<string[]> {
  const mailbox = accountEmail ?? accountId;
  const list = await gmailJson<{ messages?: Array<{ id?: string; threadId?: string }> }>(
    `/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`,
    accountId
  );
  if (!list.ok) {
    return [`### Gmail: ${mailbox}\n(error: ${list.error})`];
  }
  const refs = list.data.messages ?? [];
  if (refs.length === 0) {
    return [`### Gmail: ${mailbox}\n(no matches)`];
  }

  const lines: string[] = [`### Gmail: ${mailbox} (${refs.length} match${refs.length === 1 ? "" : "es"})`];
  for (const ref of refs.slice(0, maxResults)) {
    if (!ref.id) continue;
    const msg = await gmailJson<GmailListMessage>(
      `/messages/${encodeURIComponent(ref.id)}?format=metadata&metadataHeaders=${GMAIL_META_HEADERS}`,
      accountId
    );
    if (!msg.ok) continue;
    const fromRaw = headerValue(msg.data.payload?.headers, "From");
    const { name, email } = parseFrom(fromRaw);
    const subject = headerValue(msg.data.payload?.headers, "Subject") || "(no subject)";
    const date = headerValue(msg.data.payload?.headers, "Date");
    lines.push(
      `- [${subject}]\n` +
        `  mailbox=${mailbox}, messageId=${msg.data.id}, threadId=${msg.data.threadId ?? ref.threadId ?? "?"}\n` +
        `  from=${name} <${email}>, date=${date || "?"}\n` +
        `  snippet=${(msg.data.snippet ?? "").slice(0, 160)}`
    );
  }
  return lines;
}

async function searchMicrosoftAccount(
  accountId: string,
  accountEmail: string | undefined,
  unreadOnly: boolean,
  maxResults: number
): Promise<string[]> {
  const mailbox = accountEmail ?? accountId;
  const filter = unreadOnly ? "&$filter=isRead eq false" : "";
  const res = await graphApiJson<{
    value?: Array<{
      id?: string;
      subject?: string;
      from?: { emailAddress?: { name?: string; address?: string } };
      receivedDateTime?: string;
      bodyPreview?: string;
      conversationId?: string;
      isRead?: boolean;
    }>;
  }>(
    `/me/mailFolders/inbox/messages?$select=id,subject,from,receivedDateTime,bodyPreview,conversationId,isRead&$orderby=receivedDateTime desc&$top=${maxResults}${filter}`,
    { accountId }
  );
  if (!res.ok) {
    return [`### Outlook: ${mailbox}\n(error: ${res.error})`];
  }
  const rows = res.data.value ?? [];
  if (rows.length === 0) {
    return [`### Outlook: ${mailbox}\n(no matches)`];
  }
  const lines: string[] = [`### Outlook: ${mailbox} (${rows.length} message${rows.length === 1 ? "" : "s"})`];
  for (const m of rows) {
    if (!m.id) continue;
    const fromEmail = m.from?.emailAddress?.address ?? "";
    const fromName = m.from?.emailAddress?.name ?? fromEmail;
    lines.push(
      `- [${m.subject ?? "(no subject)"}]\n` +
        `  mailbox=${mailbox}, messageId=${m.id}, threadId=${m.conversationId ?? "?"}\n` +
        `  from=${fromName} <${fromEmail}>, received=${m.receivedDateTime ?? "?"}, read=${m.isRead === false ? "no" : "yes"}\n` +
        `  snippet=${(m.bodyPreview ?? "").slice(0, 160)}`
    );
  }
  return lines;
}

export function createMailSearchInboxesTool(): ToolDefinition {
  return defineTool({
    name: "mail_search_inboxes",
    description:
      "WHAT: Search inbox mail across **every** connected Gmail and Outlook account, grouped by mailbox.\n" +
      "WHEN: User asks what needs a reply, unread mail, or inbox review — especially with multiple accounts connected. " +
      "Prefer this over mcp_google_gmail_* alone (MCP only sees one account from connect_provider).\n" +
      "HOW: Returns messageId, threadId, mailbox per hit. Use mailbox as account_hint when drafting replies.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            'Gmail search query (default: "in:inbox is:unread"). Ignored for Outlook — uses inbox unread/recent instead.',
        },
        account_hint: {
          type: "string",
          description: "Optional — search only this mailbox (email or account id).",
        },
        max_per_account: {
          type: "number",
          description: "Max messages per mailbox (default 10, max 25).",
        },
        unread_only: {
          type: "boolean",
          description: "For Outlook: only unread inbox (default true). Gmail uses query instead.",
        },
        redact_sensitive: {
          type: "boolean",
          description:
            "Redact SSN, cards, passwords, OTPs, phones, and mask extra emails in snippets (default true). Set false only when you need verbatim snippet text for an internal draft.",
        },
      },
      additionalProperties: false,
    },
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 15_000,
    handler: async (args): Promise<ToolResult> => {
      const query =
        typeof args["query"] === "string" && args["query"].trim()
          ? args["query"].trim()
          : "in:inbox is:unread";
      const hint = typeof args["account_hint"] === "string" ? args["account_hint"].trim() : undefined;
      const maxRaw = typeof args["max_per_account"] === "number" ? args["max_per_account"] : 10;
      const maxPer = Math.max(1, Math.min(25, Math.floor(maxRaw)));
      const unreadOnly = args["unread_only"] !== false;
      const redactSensitive = args["redact_sensitive"] !== false;

      const gmailAccounts = await listGmailInboxAccounts();
      const msAccounts = await listMicrosoftInboxAccounts();

      let gmailPool = gmailAccounts;
      let msPool = msAccounts;
      if (hint) {
        const g = matchMailAccountByHint(hint, await listGoogleMailOAuthAccounts());
        const m = matchMailAccountByHint(hint, await listMicrosoftMailOAuthAccounts());
        gmailPool = g ? [{ accountId: g.accountId, email: g.email }] : [];
        msPool = m ? [{ accountId: m.accountId, email: m.email }] : [];
        if (gmailPool.length === 0 && msPool.length === 0) {
          return {
            ok: false,
            error: `No connected mailbox matches account_hint "${hint}".`,
          };
        }
      }

      if (gmailPool.length === 0 && msPool.length === 0) {
        return {
          ok: false,
          error:
            "No connected mailboxes with mail OAuth scopes. Connect Gmail or Microsoft 365 mail in Settings — unconnected integrations are not searched.",
        };
      }

      const sections: string[] = [
        `Mail search (query="${query}"${unreadOnly ? ", unread focus" : ""})`,
        "",
      ];

      for (const acct of gmailPool) {
        const block = await searchGmailAccount(acct.accountId, acct.email, query, maxPer);
        sections.push(...block, "");
      }
      for (const acct of msPool) {
        const block = await searchMicrosoftAccount(acct.accountId, acct.email, unreadOnly, maxPer);
        sections.push(...block, "");
      }

      sections.push(
        "Reply routing: pass account_hint=<mailbox> and thread_id/messageId from the **same** mailbox on gmail_create_draft / outlook_create_draft."
      );

      let output = sections.join("\n").trim();
      if (redactSensitive) {
        output = redactMailSearchToolOutput(output);
      }

      return { ok: true, output };
    },
  });
}
