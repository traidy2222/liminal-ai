/**
 * Google Sheets layout helpers — A1 parsing, column auto-fit, spacer columns.
 */
import { effectiveHarnessEnvRaw } from "@liminal/core";
import { SHEETS_BASE, googleOfficeApiJson } from "./google_office_rest_shared.js";

export interface ParsedA1Range {
  sheetTitle?: string;
  /** 0-based inclusive */
  startCol: number;
  /** 0-based exclusive */
  endCol: number;
  /** 0-based inclusive */
  startRow: number;
  /** 0-based exclusive */
  endRow: number;
}

export function colLettersToIndex(col: string): number {
  let n = 0;
  for (const c of col.toUpperCase()) {
    if (c < "A" || c > "Z") return -1;
    n = n * 26 + (c.charCodeAt(0) - 64);
  }
  return n - 1;
}

function parseCellRef(ref: string): { col: number; row: number } | null {
  const m = /^([A-Za-z]+)(\d+)$/.exec(ref.trim());
  if (!m) return null;
  const col = colLettersToIndex(m[1]!);
  const row = parseInt(m[2]!, 10) - 1;
  if (col < 0 || !Number.isFinite(row) || row < 0) return null;
  return { col, row };
}

function parseColOnly(ref: string): number | null {
  const m = /^([A-Za-z]+)$/.exec(ref.trim());
  if (!m) return null;
  const col = colLettersToIndex(m[1]!);
  return col >= 0 ? col : null;
}

/** Parse common A1 ranges used by values tools (Sheet1!A1:D10, A:D, A1, etc.). */
export function parseA1Range(range: string): ParsedA1Range | null {
  const raw = range.trim();
  if (!raw) return null;

  let sheetTitle: string | undefined;
  let a1 = raw;
  const bang = raw.lastIndexOf("!");
  if (bang > 0) {
    let sheet = raw.slice(0, bang).trim();
    if (sheet.startsWith("'") && sheet.endsWith("'")) sheet = sheet.slice(1, -1);
    sheetTitle = sheet;
    a1 = raw.slice(bang + 1).trim();
  }

  const parts = a1.split(":");
  const startPart = parts[0]?.trim() ?? "";
  const endPart = parts[1]?.trim() ?? "";

  if (!startPart) return null;

  const startCell = parseCellRef(startPart);
  if (startCell) {
    const endCell = endPart ? parseCellRef(endPart) : startCell;
    if (!endCell) return null;
    return {
      sheetTitle,
      startCol: Math.min(startCell.col, endCell.col),
      endCol: Math.max(startCell.col, endCell.col) + 1,
      startRow: Math.min(startCell.row, endCell.row),
      endRow: Math.max(startCell.row, endCell.row) + 1,
    };
  }

  const startColOnly = parseColOnly(startPart);
  if (startColOnly !== null) {
    const endColOnly = endPart ? parseColOnly(endPart) : startColOnly;
    if (endColOnly === null) return null;
    return {
      sheetTitle,
      startCol: Math.min(startColOnly, endColOnly),
      endCol: Math.max(startColOnly, endColOnly) + 1,
      startRow: 0,
      endRow: 1_000_000,
    };
  }

  return null;
}

/** Infer written grid bounds when range is an anchor like Sheet1!A1. */
export function inferGridBoundsFromValues(
  parsed: ParsedA1Range,
  values: unknown[][]
): ParsedA1Range {
  const rows = values.length;
  const cols = values.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0);
  return {
    ...parsed,
    endCol: parsed.startCol + Math.max(cols, 1),
    endRow: parsed.startRow + Math.max(rows, 1),
  };
}

export function sheetsAutoFitEnabled(args: Record<string, unknown>): boolean {
  if (args["auto_fit"] === false || args["auto_fit_columns"] === false) return false;
  if (args["auto_fit"] === true || args["auto_fit_columns"] === true) return true;
  return effectiveHarnessEnvRaw("AGENT_SHEETS_AUTO_FIT") !== "0";
}

const DEFAULT_SPACER_COL_WIDTH_PX = 28;
const MIN_DATA_COL_WIDTH_PX = 72;
const MAX_COL_WIDTH_PX = 420;
const CHAR_WIDTH_PX = 8;

function cellText(val: unknown): string {
  if (val == null) return "";
  return String(val).trim();
}

/** Columns that are entirely empty across all rows → narrow spacer width. */
export function spacerColumnIndices(values: unknown[][]): Set<number> {
  if (values.length === 0) return new Set();
  const colCount = values.reduce((m, row) => Math.max(m, Array.isArray(row) ? row.length : 0), 0);
  const spacers = new Set<number>();
  for (let c = 0; c < colCount; c++) {
    let empty = true;
    for (const row of values) {
      if (!Array.isArray(row)) continue;
      if (cellText(row[c])) {
        empty = false;
        break;
      }
    }
    if (empty) spacers.add(c);
  }
  return spacers;
}

/** Fallback pixel widths from cell text when autoResize is unavailable. */
export function estimateColumnPixelWidths(
  values: unknown[][],
  spacerCols: Set<number>
): number[] {
  const colCount = values.reduce((m, row) => Math.max(m, Array.isArray(row) ? row.length : 0), 0);
  const widths: number[] = [];
  for (let c = 0; c < colCount; c++) {
    if (spacerCols.has(c)) {
      widths.push(DEFAULT_SPACER_COL_WIDTH_PX);
      continue;
    }
    let maxLen = 0;
    for (const row of values) {
      if (!Array.isArray(row)) continue;
      maxLen = Math.max(maxLen, cellText(row[c]).length);
    }
    const px = Math.min(MAX_COL_WIDTH_PX, Math.max(MIN_DATA_COL_WIDTH_PX, maxLen * CHAR_WIDTH_PX + 24));
    widths.push(px);
  }
  return widths;
}

export function buildAutoResizeRequest(
  sheetId: number,
  startCol: number,
  endCol: number
): Record<string, unknown> {
  return {
    autoResizeDimensions: {
      dimensions: {
        sheetId,
        dimension: "COLUMNS",
        startIndex: startCol,
        endIndex: endCol,
      },
    },
  };
}

export function buildFixedColumnWidthRequests(
  sheetId: number,
  startCol: number,
  widths: number[]
): Record<string, unknown>[] {
  return widths.map((pixelSize, i) => ({
    updateDimensionProperties: {
      range: {
        sheetId,
        dimension: "COLUMNS",
        startIndex: startCol + i,
        endIndex: startCol + i + 1,
      },
      properties: { pixelSize },
      fields: "pixelSize",
    },
  }));
}

type SheetMeta = { sheetId: number; title: string };

async function fetchSheetMeta(spreadsheetId: string): Promise<SheetMeta[] | { error: string }> {
  const res = await googleOfficeApiJson<{ sheets?: Array<{ properties?: { sheetId?: number; title?: string } }> }>(
    SHEETS_BASE,
    "Sheets API",
    `/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties`
  );
  if (!res.ok) return { error: res.error };
  const sheets = res.data.sheets ?? [];
  const out: SheetMeta[] = [];
  for (const s of sheets) {
    const sheetId = s.properties?.sheetId;
    const title = s.properties?.title;
    if (typeof sheetId === "number" && title) out.push({ sheetId, title });
  }
  return out;
}

function resolveSheetIdFromMeta(meta: SheetMeta[], sheetTitle?: string): number | null {
  if (meta.length === 0) return null;
  if (!sheetTitle) return meta[0]!.sheetId;
  const hit = meta.find((s) => s.title === sheetTitle);
  return hit?.sheetId ?? meta[0]!.sheetId;
}

export interface AutoFitPlan {
  sheetId: number;
  bounds: ParsedA1Range;
  values?: unknown[][];
}

export async function planAutoFitFromRange(
  spreadsheetId: string,
  range: string,
  values?: unknown[][]
): Promise<{ ok: true; plan: AutoFitPlan } | { ok: false; error: string }> {
  const parsed = parseA1Range(range);
  if (!parsed) return { ok: false, error: `Could not parse A1 range: ${range}` };

  const bounds =
    values && values.length > 0 && parsed.endCol - parsed.startCol <= 1 && parsed.endRow - parsed.startRow <= 1
      ? inferGridBoundsFromValues(parsed, values)
      : parsed;

  const meta = await fetchSheetMeta(spreadsheetId);
  if ("error" in meta) return { ok: false, error: meta.error };
  const sheetId = resolveSheetIdFromMeta(meta, bounds.sheetTitle);
  if (sheetId === null) return { ok: false, error: "No sheets found in spreadsheet" };

  return { ok: true, plan: { sheetId, bounds, values } };
}

export function buildAutoFitBatchRequests(plan: AutoFitPlan): Record<string, unknown>[] {
  const { sheetId, bounds, values } = plan;
  const requests: Record<string, unknown>[] = [];

  if (values && values.length > 0) {
    const spacers = spacerColumnIndices(values);
    if (spacers.size > 0) {
      const widths = estimateColumnPixelWidths(values, spacers);
      for (let i = 0; i < widths.length; i++) {
        const absCol = bounds.startCol + i;
        if (spacers.has(i)) {
          requests.push(
            ...buildFixedColumnWidthRequests(sheetId, absCol, [widths[i]!])
          );
        }
      }
      // Auto-resize non-spacer column runs in one request per contiguous segment.
      let runStart: number | null = null;
      for (let i = 0; i < widths.length; i++) {
        if (spacers.has(i)) {
          if (runStart !== null && i > runStart) {
            requests.push(
              buildAutoResizeRequest(sheetId, bounds.startCol + runStart, bounds.startCol + i)
            );
          }
          runStart = null;
        } else if (runStart === null) {
          runStart = i;
        }
      }
      if (runStart !== null) {
        requests.push(
          buildAutoResizeRequest(sheetId, bounds.startCol + runStart, bounds.startCol + widths.length)
        );
      }
      return requests;
    }
  }

  requests.push(buildAutoResizeRequest(sheetId, bounds.startCol, bounds.endCol));
  // Header row slightly taller when we know row 0 is in range.
  if (bounds.startRow === 0) {
    requests.push({
      updateDimensionProperties: {
        range: {
          sheetId,
          dimension: "ROWS",
          startIndex: 0,
          endIndex: 1,
        },
        properties: { pixelSize: 32 },
        fields: "pixelSize",
      },
    });
  }
  return requests;
}

export async function applySheetAutoFit(
  spreadsheetId: string,
  range: string,
  values?: unknown[][]
): Promise<{ ok: true; requestsApplied: number } | { ok: false; error: string }> {
  const planned = await planAutoFitFromRange(spreadsheetId, range, values);
  if (!planned.ok) return planned;
  const requests = buildAutoFitBatchRequests(planned.plan);
  if (requests.length === 0) return { ok: true, requestsApplied: 0 };

  const res = await googleOfficeApiJson<unknown>(
    SHEETS_BASE,
    "Sheets API",
    `/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
    { method: "POST", body: JSON.stringify({ requests }) }
  );
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, requestsApplied: requests.length };
}
