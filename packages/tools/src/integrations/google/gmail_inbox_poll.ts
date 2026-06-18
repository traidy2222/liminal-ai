/**
 * Gmail inbox polling for the inbox watcher (no harness).
 */
import {
  getGoogleAccessToken,
  listGoogleMailOAuthAccounts,
  type InboxMessageMeta,
  type InboxPollResult,
  type InboxProviderCursorState,
} from "@liminal/core";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

type GmailJson<T> = { ok: true; data: T } | { ok: false; error: string };

export async function gmailJson<T>(
  path: string,
  accountId: string,
  init?: RequestInit
): Promise<GmailJson<T>> {
  const token = await getGoogleAccessToken(accountId);
  if (!token) {
    return { ok: false, error: "No Google OAuth token. Connect Gmail in Settings → Integrations." };
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
      /* raw */
    }
    return { ok: false, error: `Gmail API HTTP ${res.status}: ${detail}` };
  }
  if (!text.trim()) return { ok: true, data: {} as T };
  try {
    return { ok: true, data: JSON.parse(text) as T };
  } catch {
    return { ok: false, error: "Gmail API returned non-JSON" };
  }
}

function parseFromHeader(raw: string): { from: string; fromEmail: string } {
  const m = raw.match(/<([^>]+)>/);
  const email = m?.[1]?.trim() ?? raw.trim();
  const name = raw.replace(/<[^>]+>/, "").trim().replace(/^"|"$/g, "");
  return { from: name || email, fromEmail: email };
}

function headerValue(headers: Array<{ name?: string; value?: string }> | undefined, name: string): string | undefined {
  const h = headers?.find((x) => x.name?.toLowerCase() === name.toLowerCase());
  return h?.value;
}

export interface GmailInboxPollOptions {
  /** Max unread/recent inbox messages to import on first connect (0 = incremental only). */
  backfillMax?: number;
}

async function fetchGmailMessageMeta(
  accountId: string,
  accountEmail: string | undefined,
  ref: { id: string; threadId?: string }
): Promise<InboxMessageMeta | null> {
  const msg = await gmailJson<{
    id?: string;
    threadId?: string;
    snippet?: string;
    internalDate?: string;
    payload?: { headers?: Array<{ name?: string; value?: string }> };
  }>(
    `/messages/${encodeURIComponent(ref.id)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=List-Unsubscribe`,
    accountId
  );
  if (!msg.ok || !msg.data.id) return null;
  const fromRaw = headerValue(msg.data.payload?.headers, "From") ?? "";
  const { from, fromEmail } = parseFromHeader(fromRaw);
  const subject = headerValue(msg.data.payload?.headers, "Subject") ?? "(no subject)";
  const listUnsub = Boolean(headerValue(msg.data.payload?.headers, "List-Unsubscribe"));
  const ms = msg.data.internalDate ? parseInt(msg.data.internalDate, 10) : Date.now();
  return {
    id: msg.data.id,
    threadId: msg.data.threadId ?? ref.threadId,
    provider: "gmail",
    accountId,
    accountEmail,
    from,
    fromEmail,
    subject,
    snippet: msg.data.snippet ?? "",
    receivedAt: new Date(ms).toISOString(),
    listUnsubscribe: listUnsub,
  };
}

async function fetchGmailBackfill(
  accountId: string,
  accountEmail: string | undefined,
  max: number
): Promise<InboxMessageMeta[]> {
  if (max <= 0) return [];

  const unreadList = await gmailJson<{ messages?: Array<{ id?: string; threadId?: string }> }>(
    `/messages?q=${encodeURIComponent("in:inbox is:unread")}&maxResults=${max}`,
    accountId
  );
  const refs: Array<{ id: string; threadId?: string }> = [];
  const seen = new Set<string>();
  for (const m of unreadList.ok ? unreadList.data.messages ?? [] : []) {
    if (!m.id || seen.has(m.id)) continue;
    seen.add(m.id);
    refs.push({ id: m.id, threadId: m.threadId });
  }

  if (refs.length < max) {
    const recentList = await gmailJson<{ messages?: Array<{ id?: string; threadId?: string }> }>(
      `/messages?labelIds=INBOX&maxResults=${max}`,
      accountId
    );
    for (const m of recentList.ok ? recentList.data.messages ?? [] : []) {
      if (!m.id || seen.has(m.id)) continue;
      seen.add(m.id);
      refs.push({ id: m.id, threadId: m.threadId });
      if (refs.length >= max) break;
    }
  }

  const messages: InboxMessageMeta[] = [];
  for (const ref of refs.slice(0, max)) {
    const meta = await fetchGmailMessageMeta(accountId, accountEmail, ref);
    if (meta) messages.push(meta);
  }
  return messages;
}

export async function pollGmailInbox(
  accountId: string,
  cursorState: InboxProviderCursorState | null,
  options?: GmailInboxPollOptions
): Promise<InboxPollResult> {
  const backfillMax = options?.backfillMax ?? 0;
  const profile = await gmailJson<{ historyId?: string; emailAddress?: string }>("/profile", accountId);
  if (!profile.ok) return { ok: false, error: profile.error, messages: [], cursor: "", baselineEstablished: false };

  const currentHistoryId = String(profile.data.historyId ?? "");
  if (!currentHistoryId) {
    return { ok: false, error: "Gmail profile missing historyId", messages: [], cursor: "", baselineEstablished: false };
  }

  const accountEmail = profile.data.emailAddress?.trim() || undefined;

  if (!cursorState?.baselineEstablished) {
    if (!cursorState) {
      if (backfillMax <= 0) {
        return { ok: true, messages: [], cursor: currentHistoryId, baselineEstablished: false };
      }
      const messages = await fetchGmailBackfill(accountId, accountEmail, backfillMax);
      return {
        ok: true,
        messages,
        cursor: currentHistoryId,
        baselineEstablished: true,
        backfillCompleted: true,
      };
    }
    if (backfillMax <= 0) {
      return { ok: true, messages: [], cursor: currentHistoryId, baselineEstablished: true };
    }
      const messages = await fetchGmailBackfill(accountId, accountEmail, backfillMax);
    return {
      ok: true,
      messages,
      cursor: currentHistoryId,
      baselineEstablished: true,
      backfillCompleted: true,
    };
  }

  if (backfillMax > 0 && !cursorState.backfillCompleted) {
      const messages = await fetchGmailBackfill(accountId, accountEmail, backfillMax);
    return {
      ok: true,
      messages,
      cursor: currentHistoryId,
      baselineEstablished: true,
      backfillCompleted: true,
    };
  }

  const stored = cursorState.cursor;
  if (stored === currentHistoryId) {
    return { ok: true, messages: [], cursor: currentHistoryId, baselineEstablished: true };
  }

  const history = await gmailJson<{
    history?: Array<{ messagesAdded?: Array<{ message?: { id?: string; threadId?: string } }> }>;
    historyId?: string;
  }>(
    `/history?startHistoryId=${encodeURIComponent(stored)}&historyTypes=messageAdded&maxResults=50`,
    accountId
  );

  if (!history.ok) {
    if (history.error.includes("404") || history.error.toLowerCase().includes("history")) {
      return { ok: true, messages: [], cursor: currentHistoryId, baselineEstablished: true };
    }
    return { ok: false, error: history.error, messages: [], cursor: currentHistoryId, baselineEstablished: true };
  }

  const ids: Array<{ id: string; threadId?: string }> = [];
  for (const block of history.data.history ?? []) {
    for (const added of block.messagesAdded ?? []) {
      const id = added.message?.id;
      if (id) ids.push({ id, threadId: added.message?.threadId });
    }
  }

  const messages: InboxMessageMeta[] = [];
  for (const ref of ids.slice(0, 25)) {
    const meta = await fetchGmailMessageMeta(accountId, accountEmail, { id: ref.id, threadId: ref.threadId });
    if (meta) messages.push(meta);
  }

  return {
    ok: true,
    messages,
    cursor: history.data.historyId ?? currentHistoryId,
    baselineEstablished: true,
  };
}

export async function applyGmailLabel(
  accountId: string,
  messageId: string,
  labelName: string
): Promise<{ ok: boolean; error?: string; labelApplied?: string }> {
  const labels = await gmailJson<{ labels?: Array<{ id?: string; name?: string }> }>("/labels", accountId);
  if (!labels.ok) return { ok: false, error: labels.error };

  let labelId = labels.data.labels?.find((l) => l.name === labelName)?.id;
  if (!labelId) {
    const created = await gmailJson<{ id?: string }>("/labels", accountId, {
      method: "POST",
      body: JSON.stringify({
        name: labelName,
        labelListVisibility: "labelShow",
        messageListVisibility: "show",
      }),
    });
    if (!created.ok) return { ok: false, error: created.error };
    labelId = created.data.id;
  }
  if (!labelId) return { ok: false, error: "Could not resolve Gmail label id" };

  const mod = await gmailJson<unknown>(`/messages/${encodeURIComponent(messageId)}/modify`, accountId, {
    method: "POST",
    body: JSON.stringify({ addLabelIds: [labelId] }),
  });
  if (!mod.ok) return { ok: false, error: mod.error };
  return { ok: true, labelApplied: labelName };
}

export async function listGmailInboxAccounts(): Promise<Array<{ accountId: string; email?: string }>> {
  const accounts = await listGoogleMailOAuthAccounts();
  return accounts.map((a) => ({ accountId: a.accountId, email: a.email }));
}
