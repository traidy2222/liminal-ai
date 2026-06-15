/**
 * Microsoft Graph inbox delta polling for the inbox watcher.
 */
import {
  listOAuthAccounts,
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
}

interface GraphDeltaResponse {
  value?: GraphMessage[];
  "@odata.nextLink"?: string;
  "@odata.deltaLink"?: string;
}

export async function pollMicrosoftInbox(
  accountId: string,
  cursorState: InboxProviderCursorState | null
): Promise<InboxPollResult> {
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
    if (!cursorState) {
      return { ok: true, messages: [], cursor: deltaLink, baselineEstablished: false };
    }
    return { ok: true, messages: [], cursor: deltaLink, baselineEstablished: true };
  }

  const value = res.data.value ?? [];
  if (value.length === 0) {
    return { ok: true, messages: [], cursor: deltaLink, baselineEstablished: true };
  }

  const messages: InboxMessageMeta[] = value
    .filter((m) => m.id)
    .map((m) => {
      const fromEmail = m.from?.emailAddress?.address ?? "";
      const fromName = m.from?.emailAddress?.name ?? fromEmail;
      return {
        id: m.id!,
        threadId: m.conversationId,
        provider: "microsoft" as const,
        accountId,
        from: fromName,
        fromEmail,
        subject: m.subject ?? "(no subject)",
        snippet: m.bodyPreview ?? "",
        receivedAt: m.receivedDateTime ?? new Date().toISOString(),
      };
    });

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
  const accounts = await listOAuthAccounts("microsoft");
  return accounts.map((a) => ({ accountId: a.accountId, email: a.email }));
}
