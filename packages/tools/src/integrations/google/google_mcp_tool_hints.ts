/**
 * Per-tool hints appended to Google MCP tool descriptions so models use correct arg shapes.
 */

const DRIVE_SEARCH_HINT =
  "Drive query dates MUST be ISO8601 UTC inside quotes, e.g. modifiedTime > \"2024-06-05T00:00:00Z\" (not bare 2024-06-05).";

const PAGINATION_HINT =
  "Pagination: pageSize (int, default 25); aliases page_size, limit. pageToken for next page.";

const CALENDAR_HINT =
  "calendarId defaults to \"primary\" when omitted. Times must be RFC3339 (2024-06-05T09:00:00Z).";

const GMAIL_DRAFT_HINT =
  "Use the discovered schema: body is plain text; htmlBody is HTML when declared; replyToMessageId targets an existing Gmail message. Use REST helpers for attachments or explicit account_hint. Create one draft per requested email.";
const GMAIL_ID_HINT =
  "Copy exact messageId/threadId values from a successful search/get in this connection's mailbox. Message IDs, thread IDs and RFC Message-ID headers are different; never invent or shorten them.";

export function enrichGoogleMcpToolDescription(
  connectionName: string,
  remoteName: string,
  baseDescription: string
): string {
  const remote = remoteName.toLowerCase();
  const hints: string[] = [];

  if (connectionName === "google_drive") {
    if (remote.includes("search") || remote.includes("query")) hints.push(DRIVE_SEARCH_HINT);
    if (remote.includes("list")) hints.push(PAGINATION_HINT);
  }
  if (connectionName === "google_gmail") {
    if (remote.includes("list") || remote.includes("search")) hints.push(PAGINATION_HINT);
    if (remote === "create_draft") hints.push(GMAIL_DRAFT_HINT);
    if (remote.includes("message") || remote.includes("thread") || remote === "create_draft") hints.push(GMAIL_ID_HINT);
    if (remote === "search_threads") hints.push("Search returns thread summaries, not full bodies. Use get_thread for full content. Reuse nextPageToken as pageToken without changing the query.");
  }
  if (connectionName === "google_calendar") {
    hints.push(CALENDAR_HINT);
    if (remote.includes("list")) hints.push(PAGINATION_HINT);
  }
  if (connectionName === "google_chat") {
    if (remote.includes("list") || remote.includes("search")) hints.push(PAGINATION_HINT);
  }
  if (connectionName === "google_people") {
    hints.push("People/directory may 403 without People API enabled + Workspace Developer Preview.");
  }

  if (hints.length === 0) return baseDescription;
  return `${baseDescription}\n${hints.map((h) => `ARG: ${h}`).join("\n")}`;
}
