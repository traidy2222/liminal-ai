/**
 * Microsoft Graph inbox delta polling for the inbox watcher.
 */
import {
  listMicrosoftMailOAuthAccounts,
  type InboxMessageMeta,
  type InboxPollResult,
  type InboxProviderCursorState,
} from "@liminal/core";
import { graphApiJson } from "./graph_rest.js";

const DELTA_SELECT = "id,subject,from,receivedDateTime,isRead,bodyPreview,conversationId";

interface GraphMessage {
  id?: string;
  subject?: string;
  from?: { emailAddress?: { name?: string; address?: string } };
  receivedDateTime?: string;
  bodyPreview?: string;
  conversationId?: string;
  isRead?: boolean;
}

interface GraphDeltaResponse {
  value?: GraphMessage[];
  "@odata.nextLink"?: string;
  "@odata.deltaLink"?: string;
}

interface GraphListResponse {
  value?: GraphMessage[];
}

export interface MicrosoftInboxPollOptions {
  /** Max unread/recent inbox messages to import on first connect (0 = incremental only). */
  backfillMax?: number;
}

function mapGraphMessage(
  m: GraphMessage,
  accountId: string,
  accountEmail?: string
): InboxMessageMeta | null {
  if (!m.id) return null;
  const fromEmail = m.from?.emailAddress?.address ?? "";
  const fromName = m.from?.emailAddress?.name ?? fromEmail;
  return {
    id: m.id,
    threadId: m.conversationId,
    provider: "microsoft",
    accountId,
    accountEmail,
    from: fromName,
    fromEmail,
    subject: m.subject ?? "(no subject)",
    snippet: m.bodyPreview ?? "",
    receivedAt: m.receivedDateTime ?? new Date().toISOString(),
  };
}

function selectBackfillMessages(value: GraphMessage[], max: number): GraphMessage[] {
  const withId = value.filter((m) => m.id);
  const byDate = (a: GraphMessage, b: GraphMessage) =>
    Date.parse(b.receivedDateTime ?? "") - Date.parse(a.receivedDateTime ?? "");
  const unread = withId.filter((m) => m.isRead === false).sort(byDate);
  if (unread.length >= max) return unread.slice(0, max);

  const read = withId.filter((m) => m.isRead !== false).sort(byDate);
  const seen = new Set<string>();
  const out: GraphMessage[] = [];
  for (const m of [...unread, ...read]) {
    if (!m.id || seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
    if (out.length >= max) break;
  }
  return out;
}

async function fetchMicrosoftBackfill(
  accountId: string,
  accountEmail: string | undefined,
  max: number
): Promise<InboxMessageMeta[]> {
  if (max <= 0) return [];

  const unreadRes = await graphApiJson<GraphListResponse>(
    `/me/mailFolders/inbox/messages?$filter=isRead eq false&$select=${DELTA_SELECT}&$orderby=receivedDateTime desc&$top=${max}`,
    { accountId }
  );
  const messages: InboxMessageMeta[] = [];
  const seen = new Set<string>();
  if (unreadRes.ok) {
    for (const m of unreadRes.data.value ?? []) {
      const meta = mapGraphMessage(m, accountId, accountEmail);
      if (!meta || seen.has(meta.id)) continue;
      seen.add(meta.id);
      messages.push(meta);
    }
  }

  if (messages.length < max) {
    const recentRes = await graphApiJson<GraphListResponse>(
      `/me/mailFolders/inbox/messages?$select=${DELTA_SELECT}&$orderby=receivedDateTime desc&$top=${max}`,
      { accountId }
    );
    if (recentRes.ok) {
      for (const m of recentRes.data.value ?? []) {
        const meta = mapGraphMessage(m, accountId, accountEmail);
        if (!meta || seen.has(meta.id)) continue;
        seen.add(meta.id);
        messages.push(meta);
        if (messages.length >= max) break;
      }
    }
  }

  return messages.slice(0, max);
}

export async function pollMicrosoftInbox(
  accountId: string,
  cursorState: InboxProviderCursorState | null,
  options?: MicrosoftInboxPollOptions
): Promise<InboxPollResult> {
  const backfillMax = options?.backfillMax ?? 0;
  const accounts = await listMicrosoftMailOAuthAccounts();
  const accountEmail = accounts.find((a) => a.accountId === accountId)?.email;
  const deltaPath =
    cursorState?.baselineEstablished && cursorState.cursor
      ? cursorState.cursor
      : `/me/mailFolders/inbox/messages/delta?$select=${DELTA_SELECT}&$top=25`;

  const res = await graphApiJson<GraphDeltaResponse>(deltaPath, { accountId });
  if (!res.ok) {
    return { ok: false, error: res.error, messages: [], cursor: cursorState?.cursor ?? "", baselineEstablished: false };
  }

  const deltaLink = res.data["@odata.deltaLink"] ?? res.data["@odata.nextLink"] ?? "";
  if (!deltaLink) {
    return { ok: false, error: "Graph delta missing deltaLink", messages: [], cursor: "", baselineEstablished: false };
  }

  if (!cursorState?.baselineEstablished) {
    const value = res.data.value ?? [];
    if (!cursorState) {
      if (backfillMax <= 0) {
        return { ok: true, messages: [], cursor: deltaLink, baselineEstablished: false };
      }
      const picked = selectBackfillMessages(value, backfillMax);
      const messages = picked
        .map((m) => mapGraphMessage(m, accountId, accountEmail))
        .filter((m): m is InboxMessageMeta => m != null);
      return {
        ok: true,
        messages,
        cursor: deltaLink,
        baselineEstablished: true,
        backfillCompleted: true,
      };
    }
    if (backfillMax <= 0) {
      return { ok: true, messages: [], cursor: deltaLink, baselineEstablished: true };
    }
    const picked = selectBackfillMessages(value, backfillMax);
    const messages = picked
      .map((m) => mapGraphMessage(m, accountId, accountEmail))
      .filter((m): m is InboxMessageMeta => m != null);
    return {
      ok: true,
      messages,
      cursor: deltaLink,
      baselineEstablished: true,
      backfillCompleted: true,
    };
  }

  if (backfillMax > 0 && !cursorState.backfillCompleted) {
    const messages = await fetchMicrosoftBackfill(accountId, accountEmail, backfillMax);
    return {
      ok: true,
      messages,
      cursor: deltaLink,
      baselineEstablished: true,
      backfillCompleted: true,
    };
  }

  const value = res.data.value ?? [];
  if (value.length === 0) {
    return { ok: true, messages: [], cursor: deltaLink, baselineEstablished: true };
  }

  const messages: InboxMessageMeta[] = value
    .map((m) => mapGraphMessage(m, accountId, accountEmail))
    .filter((m): m is InboxMessageMeta => m != null);

  return { ok: true, messages, cursor: deltaLink, baselineEstablished: true };
}

export async function applyMicrosoftCategory(
  accountId: string,
  messageId: string,
  categoryName: string
): Promise<{ ok: boolean; error?: string; labelApplied?: string }> {
  const res = await graphApiJson<unknown>(`/me/messages/${encodeURIComponent(messageId)}`, {
    method: "PATCH",
    accountId,
    body: JSON.stringify({ categories: [categoryName] }),
  });
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, labelApplied: categoryName };
}

export async function listMicrosoftInboxAccounts(): Promise<Array<{ accountId: string; email?: string }>> {
  const accounts = await listMicrosoftMailOAuthAccounts();
  return accounts.map((a) => ({ accountId: a.accountId, email: a.email }));
}
