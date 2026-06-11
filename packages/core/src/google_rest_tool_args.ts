/**
 * Model-friendly arg normalization for Google REST tools (sheets, calendar, docs, gmail).
 */

import { coerceJsonArrayValue } from "./tool_arg_coerce.js";

function firstString(args: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const v = args[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

/** Date-only YYYY-MM-DD → RFC3339 UTC midnight. */
export function toRfc3339DateTime(val: string): string {
  const s = val.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T00:00:00Z`;
  return s;
}

/** Coerce Sheets 2D values: JSON string, flat row, or nested array. */
export function coerceSheetsValues(val: unknown): unknown {
  let arr = coerceJsonArrayValue(val);
  if (!Array.isArray(arr)) {
    if (typeof val === "string" && val.includes(",") && !val.trim().startsWith("[")) {
      return [val.split(",").map((c) => c.trim())];
    }
    return arr;
  }
  if (arr.length === 0) return arr;
  if (!Array.isArray(arr[0])) {
    return [arr];
  }
  return arr;
}

function normalizeIsoTimeFields(out: Record<string, unknown>, keys: string[]): void {
  for (const key of keys) {
    const v = out[key];
    if (typeof v === "string" && v.trim()) out[key] = toRfc3339DateTime(v);
  }
}

function mapDocumentId(out: Record<string, unknown>, name: string): void {
  if (!name.startsWith("docs_rest_") || name === "docs_rest_create_document") return;
  const documentId = firstString(out, [
    "document_id",
    "documentId",
    "doc_id",
    "docId",
    "file_id",
    "fileId",
    "id",
  ]);
  if (documentId) out.document_id = documentId;
}

function mapPresentationId(out: Record<string, unknown>, name: string): void {
  if (!name.startsWith("slides_rest_") || name === "slides_rest_create_presentation") return;
  const id = firstString(out, ["presentation_id", "presentationId", "file_id", "fileId", "id"]);
  if (id) out.presentation_id = id;
}

function mapSpreadsheetId(out: Record<string, unknown>, name: string): void {
  if (!name.startsWith("sheets_rest_") || name === "sheets_rest_create_spreadsheet") return;
  const id = firstString(out, ["spreadsheet_id", "spreadsheetId", "sheet_id", "file_id", "fileId", "id"]);
  if (id) out.spreadsheet_id = id;
}

function mapFileId(out: Record<string, unknown>, name: string): void {
  if (!name.startsWith("office_rest_")) return;
  const id = firstString(out, ["file_id", "fileId", "document_id", "documentId", "id"]);
  if (id) out.file_id = id;
}

function mapCalendarFields(out: Record<string, unknown>, name: string): void {
  if (!name.startsWith("calendar_rest_")) return;
  const calendarId = firstString(out, ["calendar_id", "calendarId", "calendar"]);
  if (calendarId) out.calendar_id = calendarId;
  const eventId = firstString(out, ["event_id", "eventId", "id"]);
  if (eventId && name.includes("event")) out.event_id = eventId;
  const timeMin = firstString(out, ["time_min", "timeMin", "start_time", "start", "from"]);
  if (timeMin) out.time_min = toRfc3339DateTime(timeMin);
  const timeMax = firstString(out, ["time_max", "timeMax", "end_time", "end", "to"]);
  if (timeMax) out.time_max = toRfc3339DateTime(timeMax);
}

function mapGmailFields(out: Record<string, unknown>, name: string): void {
  if (!name.startsWith("gmail_")) return;
  const to = out["to"];
  if (typeof to === "string" && to.trim()) out.to = [to.trim()];
  const subject = firstString(out, ["subject", "title"]);
  if (subject) out.subject = subject;
  const body = firstString(out, ["body", "text", "message", "content"]);
  if (body && !out["body"]) out.body = body;
  const threadId = firstString(out, ["thread_id", "threadId"]);
  if (threadId) out.thread_id = threadId;
  const draftId = firstString(out, ["draft_id", "draftId", "id"]);
  if (draftId && name === "gmail_send_draft") out.draft_id = draftId;
}

export function normalizeGoogleRestToolArgs(
  name: string,
  args: Record<string, unknown>
): Record<string, unknown> {
  if (
    !name.startsWith("sheets_rest_") &&
    !name.startsWith("calendar_rest_") &&
    !name.startsWith("docs_rest_") &&
    !name.startsWith("slides_rest_") &&
    !name.startsWith("office_rest_") &&
    !name.startsWith("gmail_")
  ) {
    return args;
  }

  const out = { ...args };

  mapDocumentId(out, name);
  mapPresentationId(out, name);
  mapSpreadsheetId(out, name);
  mapFileId(out, name);
  mapCalendarFields(out, name);
  mapGmailFields(out, name);

  if (name.startsWith("sheets_rest_") && "values" in out) {
    out.values = coerceSheetsValues(out["values"]);
  }
  if (name.startsWith("sheets_rest_") && "requests" in out) {
    out.requests = coerceJsonArrayValue(out["requests"]);
  }
  if (name.startsWith("sheets_rest_") && "data" in out) {
    out.data = coerceJsonArrayValue(out["data"]);
  }
  if (name.startsWith("sheets_rest_") && "ranges" in out && typeof out["ranges"] === "string") {
    const ranges = coerceJsonArrayValue(out["ranges"]);
    if (Array.isArray(ranges)) out.ranges = ranges;
    else out.ranges = [out["ranges"]];
  }

  if (name.startsWith("docs_rest_") && "blocks" in out) {
    out.blocks = coerceJsonArrayValue(out["blocks"]);
  }
  if (name.startsWith("docs_rest_") && "requests" in out) {
    out.requests = coerceJsonArrayValue(out["requests"]);
  }
  if (name === "docs_rest_insert_table" && "rows" in out) {
    out.rows = coerceJsonArrayValue(out["rows"]);
  }
  if (name.startsWith("slides_rest_") && "requests" in out) {
    out.requests = coerceJsonArrayValue(out["requests"]);
  }

  if (name.includes("batch_get") && typeof out["ranges"] === "string") {
    const ranges = coerceJsonArrayValue(out["ranges"]);
    if (Array.isArray(ranges)) out.ranges = ranges;
    else out.ranges = [out["ranges"]];
  }

  normalizeIsoTimeFields(out, ["time_min", "time_max", "start", "end", "start_time", "end_time"]);

  return out;
}

/** Semantic required-field checks after alias normalization. */
export function validateGoogleRestToolArgs(
  name: string,
  args: Record<string, unknown>
): string | null {
  if (name.startsWith("docs_rest_") && name !== "docs_rest_create_document") {
    if (!firstString(args, ["document_id", "documentId", "file_id"])) {
      return 'document_id is required (aliases: documentId, file_id, id)';
    }
  }
  if (name === "docs_rest_write_blocks" && !Array.isArray(args["blocks"])) {
    return "blocks must be an array (JSON array of block objects)";
  }
  if (name === "docs_rest_batch_update" && !Array.isArray(args["requests"])) {
    return "requests must be an array of Docs API batchUpdate request objects";
  }
  if (name === "slides_rest_batch_update" && !Array.isArray(args["requests"])) {
    return "requests must be an array of Slides API batchUpdate request objects";
  }
  if (name === "sheets_rest_batch_update" && !Array.isArray(args["requests"])) {
    return "requests must be an array of Sheets API batchUpdate request objects";
  }
  if (name === "sheets_rest_batch_update_values" && "data" in args && !Array.isArray(args["data"])) {
    return "data must be an array of Sheets ValueRange objects ({ range, values })";
  }
  if (
    name.startsWith("sheets_rest_") &&
    name.includes("values") &&
    name !== "sheets_rest_batch_update_values" &&
    "values" in args
  ) {
    if (!Array.isArray(args["values"])) {
      return 'values must be a 2D array like [["a","b"],["c","d"]]';
    }
  }
  return null;
}
