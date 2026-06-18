/**
 * Multi-mailbox routing — session context, account_hint resolution, turn detection.
 */
import { isEmailComposeTurn } from "./email_compose_context.js";
import { pickBestOAuthAccountByEmail, type OAuthAccountRef } from "./oauth_account_pick.js";

export type MailProvider = "google" | "microsoft";

export interface MailAccountRef extends OAuthAccountRef {
  provider: MailProvider;
}

export interface MailSessionContext {
  provider?: MailProvider;
  accountId?: string;
  accountEmail?: string;
  threadId?: string;
  messageId?: string;
  subject?: string;
  fromEmail?: string;
  updatedAt: string;
}

/** User turn about inbox, replies, or mail triage (not only compose). */
export function isMailInboxTurn(text: string): boolean {
  const t = text.trim();
  if (t.length < 4) return false;
  return (
    /\b(inbox|unread|reply\s+to|anything\s+to\s+reply|need(s)?\s+(a\s+)?reply|waiting\s+on\s+me|action\s+items?)\b/i.test(
      t
    ) ||
    /\b(check|show|list|scan|review)\b[\s\S]{0,64}\b(e-?mail|mail|inbox|gmail|outlook)\b/i.test(t) ||
    /\b(e-?mail|mail|inbox)\b[\s\S]{0,64}\b(check|show|list|scan|review|reply)\b/i.test(t) ||
    /\bmail_search_inboxes\b/i.test(t)
  );
}

/** Short follow-up that likely continues a mail thread discussed earlier. */
export function isMailReplyContinuationTurn(text: string): boolean {
  const t = text.trim();
  if (t.length > 200) return false;
  return (
    /\b(reply|respond|send\s+it|send\s+that|draft\s+(a\s+)?reply|that\s+(email|message|thread|one))\b/i.test(
      t
    ) && !isEmailComposeTurn(t)
  );
}

export function shouldInjectMailAccountGuidance(text: string): boolean {
  return isEmailComposeTurn(text) || isMailInboxTurn(text) || isMailReplyContinuationTurn(text);
}

export const MAIL_ACCOUNT_TURN_INJECTION =
  "[MAIL ACCOUNTS] Check **connected** mail only — call mail_search_inboxes first (it scans Gmail/Outlook accounts with mail OAuth scopes only; skips unconnected providers and Entra guest admin logins). " +
  "Do not call connect_provider, mcp_*, or outlook_* for providers list_connectors shows as not connected. " +
  "When drafting or sending, pass account_hint with the **receiving** mailbox email. Replies must use that account_hint plus thread_id / reply_to_message_id from the same mailbox.";

export function matchMailAccountByHint<T extends OAuthAccountRef>(
  hint: string | undefined,
  accounts: readonly T[]
): T | undefined {
  if (!hint?.trim() || accounts.length === 0) return undefined;
  const h = hint.trim().toLowerCase();
  return accounts.find(
    (a) => a.accountId === hint.trim() || a.email?.trim().toLowerCase() === h
  );
}

export function formatConnectedMailAccounts(accounts: readonly OAuthAccountRef[]): string {
  return accounts.map((a) => a.email ?? a.accountId).join(", ");
}

/**
 * Resolve Gmail account for compose/send. With multiple accounts, account_hint is required.
 */
export function resolveGoogleMailAccount(
  hint: string | undefined,
  accounts: readonly OAuthAccountRef[]
): { account: OAuthAccountRef } | { error: string } {
  if (accounts.length === 0) {
    return { error: "No Google accounts connected. Connect Gmail in Settings → Integrations." };
  }
  const matched = matchMailAccountByHint(hint, accounts);
  if (matched) return { account: matched };
  if (!hint?.trim()) {
    if (accounts.length === 1) return { account: accounts[0]! };
    return {
      error:
        `Multiple Gmail accounts connected (${formatConnectedMailAccounts(accounts)}). ` +
        "Pass account_hint with the mailbox that received or should send this message. " +
        "Use mail_search_inboxes to list mail per account.",
    };
  }
  return {
    error:
      `Unknown account_hint "${hint}". Connected Gmail: ${formatConnectedMailAccounts(accounts)}.`,
  };
}

/** Same as resolveGoogleMailAccount for Microsoft Graph mail. */
export function resolveMicrosoftMailAccount(
  hint: string | undefined,
  accounts: readonly OAuthAccountRef[]
): { account: OAuthAccountRef } | { error: string } {
  if (accounts.length === 0) {
    return { error: "No Microsoft accounts connected. Connect Microsoft 365 in Settings → Integrations." };
  }
  const matched = matchMailAccountByHint(hint, accounts);
  if (matched) return { account: matched };
  if (!hint?.trim()) {
    if (accounts.length === 1) return { account: accounts[0]! };
    return {
      error:
        `Multiple Microsoft mailboxes connected (${formatConnectedMailAccounts(accounts)}). ` +
        "Pass account_hint with the mailbox that received or should send this message.",
    };
  }
  return {
    error:
      `Unknown account_hint "${hint}". Connected Microsoft: ${formatConnectedMailAccounts(accounts)}.`,
  };
}

function pickField(args: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const v = args[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function parseOutputFields(output: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of output.matchAll(
    /(?:fromAccount|accountEmail|account_hint|threadId|messageId|draftId|subject)=([^\s,;)]+)/gi
  )) {
    const key = m[0]!.split("=")[0]!.toLowerCase();
    out[key] = m[1]!;
  }
  return out;
}

function parseMailSearchInboxHit(output: string): Partial<MailSessionContext> | null {
  const hit = output.match(
    /- \[([^\]]+)\]\s*\n\s*mailbox=([^\s,]+), messageId=([^\s,]+), threadId=([^\s\n]+)\s*\n\s*from=[^<]*<([^>]+)>/i
  );
  if (!hit) return null;
  return {
    subject: hit[1]?.trim(),
    accountEmail: hit[2]?.trim(),
    messageId: hit[3]?.trim(),
    threadId: hit[4]?.trim(),
    fromEmail: hit[5]?.trim(),
  };
}

/** Extract mailbox/thread hints from a mail tool call for cross-turn continuity. */
export function parseMailSessionFromToolOutput(
  toolName: string,
  argsJson: string,
  output: string
): Partial<MailSessionContext> | null {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(argsJson) as Record<string, unknown>;
  } catch {
    /* keep empty */
  }

  const patch: Partial<MailSessionContext> = {};
  const hint = pickField(args, ["account_hint", "accountHint", "mailbox"]);
  if (hint) {
    if (hint.includes("@")) patch.accountEmail = hint;
    else patch.accountId = hint;
  }

  const threadId = pickField(args, ["thread_id", "threadId"]);
  const messageId = pickField(args, ["reply_to_message_id", "message_id", "messageId"]);
  const subject = pickField(args, ["subject"]);
  if (threadId) patch.threadId = threadId;
  if (messageId) patch.messageId = messageId;
  if (subject) patch.subject = subject;

  const parsed = parseOutputFields(output);
  if (parsed.threadid) patch.threadId = parsed.threadid;
  if (parsed.messageid) patch.messageId = parsed.messageid;
  if (parsed.fromaccount) patch.accountEmail = parsed.fromaccount;
  if (parsed.accountemail) patch.accountEmail = parsed.accountemail;

  const mailTools = new Set([
    "gmail_create_draft",
    "gmail_send_draft",
    "gmail_send_message",
    "outlook_create_draft",
    "outlook_send_draft",
    "outlook_send_message",
    "mail_search_inboxes",
    "mcp_google_gmail_search_emails",
    "mcp_google_gmail_get_thread",
    "mcp_google_gmail_get_message",
  ]);
  const isMailTool =
    mailTools.has(toolName) ||
    toolName.startsWith("mcp_google_gmail_") ||
    toolName.startsWith("mcp_microsoft_");

  if (!isMailTool && !patch.threadId && !patch.messageId && !patch.accountEmail) {
    return null;
  }

  if (toolName.includes("gmail") || toolName.startsWith("mcp_google_gmail")) {
    patch.provider = "google";
  } else if (toolName.includes("outlook") || toolName.startsWith("mcp_microsoft")) {
    patch.provider = "microsoft";
  }

  if (toolName === "mail_search_inboxes") {
    const hit = parseMailSearchInboxHit(output);
    if (hit) {
      if (hit.accountEmail) patch.accountEmail = hit.accountEmail;
      if (hit.messageId) patch.messageId = hit.messageId;
      if (hit.threadId) patch.threadId = hit.threadId;
      if (hit.subject) patch.subject = hit.subject;
      if (hit.fromEmail) patch.fromEmail = hit.fromEmail;
      patch.provider = output.includes("### Outlook:") && !output.includes("### Gmail:")
        ? "microsoft"
        : output.includes("### Gmail:")
          ? "google"
          : patch.provider;
    } else {
      const firstMailbox = output.match(/mailbox=([^\s\n]+)/i)?.[1];
      if (firstMailbox && !patch.accountEmail) patch.accountEmail = firstMailbox;
    }
  }

  if (!patch.accountEmail && !patch.threadId && !patch.messageId && !patch.subject) {
    return null;
  }

  return patch;
}

export function mergeMailSessionContext(
  prev: MailSessionContext | null,
  patch: Partial<MailSessionContext>
): MailSessionContext {
  return {
    provider: patch.provider ?? prev?.provider,
    accountId: patch.accountId ?? prev?.accountId,
    accountEmail: patch.accountEmail ?? prev?.accountEmail,
    threadId: patch.threadId ?? prev?.threadId,
    messageId: patch.messageId ?? prev?.messageId,
    subject: patch.subject ?? prev?.subject,
    fromEmail: patch.fromEmail ?? prev?.fromEmail,
    updatedAt: new Date().toISOString(),
  };
}

export function buildMailSessionContextInjection(ctx: MailSessionContext | null): string | null {
  if (!ctx?.accountEmail && !ctx?.threadId && !ctx?.messageId) return null;
  const parts: string[] = ["[MAIL CONTEXT — carry forward this turn]"];
  if (ctx.accountEmail) {
    parts.push(`Active mailbox: ${ctx.accountEmail}${ctx.provider ? ` (${ctx.provider})` : ""}.`);
    parts.push(`Pass account_hint="${ctx.accountEmail}" on gmail_create_draft / outlook_create_draft / send tools.`);
  }
  if (ctx.subject) parts.push(`Subject: ${ctx.subject}`);
  if (ctx.fromEmail) parts.push(`From: ${ctx.fromEmail}`);
  if (ctx.threadId) parts.push(`thread_id=${ctx.threadId}`);
  if (ctx.messageId) parts.push(`reply_to_message_id=${ctx.messageId}`);
  parts.push("Replies must send from the mailbox that received the message — not the default/first account.");
  return parts.join(" ");
}

/** Prefer explicit hint, else session mailbox, else single-account default. */
export function pickMailAccountForCompose(
  hint: string | undefined,
  session: MailSessionContext | null,
  accounts: readonly OAuthAccountRef[]
): { account: OAuthAccountRef } | { error: string } {
  const effectiveHint = hint?.trim() || session?.accountEmail || session?.accountId;
  const resolved = resolveGoogleMailAccount(effectiveHint, accounts);
  if ("error" in resolved && !hint?.trim() && accounts.length > 1) {
    const best = pickBestOAuthAccountByEmail(accounts);
    if (session?.threadId || session?.messageId) {
      return resolved;
    }
    if (best && accounts.length > 1) {
      return resolved;
    }
  }
  return resolved;
}
