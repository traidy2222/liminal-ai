/**
 * Helpers to read and write rich Google Docs content via batchUpdate.
 */
import type { PropertySchema } from "@liminal/core";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { DRIVE_BASE, googleOfficeApiJson } from "./google_office_rest_shared.js";

type DocElement = {
  startIndex?: number;
  endIndex?: number;
  paragraph?: {
    elements?: Array<{
      startIndex?: number;
      endIndex?: number;
      textRun?: { content?: string; textStyle?: Record<string, unknown> };
    }>;
    paragraphStyle?: { namedStyleType?: string; bullet?: unknown };
  };
  table?: {
    tableRows?: Array<{
      tableCells?: Array<{ content?: DocElement[] }>;
    }>;
  };
  sectionBreak?: unknown;
};

/** `blocks` accepts a native array or a JSON string (models often stringify). */
export function docsBlocksFieldSchema(): PropertySchema {
  return {
    anyOf: [
      {
        type: "array",
        description: "Ordered content blocks to append.",
        items: docsBlockPropertySchema(),
      },
      {
        type: "string",
        description: "JSON array of block objects — auto-parsed at execution time.",
      },
    ],
    description: "Document content blocks (array preferred).",
  } as PropertySchema;
}

/** Tool schema for one write_blocks element — helps models emit arrays of objects. */
export function docsBlockPropertySchema(): PropertySchema {
  return {
    type: "object",
    description: "One content block with required type field.",
    properties: {
      type: {
        type: "string",
        enum: [
        "title",
        "subtitle",
        "heading",
        "paragraph",
        "bullet_list",
        "numbered_list",
        "table",
        "link",
        "image",
        "page_break",
        "divider",
      ],
      },
      level: { type: "number", description: "Heading level 1–6." },
      text: { type: "string" },
      bold: { type: "boolean" },
      italic: { type: "boolean" },
      underline: { type: "boolean" },
      alignment: {
        type: "string",
        enum: ["START", "CENTER", "END", "JUSTIFIED"],
        description: "Paragraph alignment.",
      },
      color_hex: { type: "string", description: "Text color e.g. #333333." },
      font_size_pt: { type: "number" },
      space_above_pt: { type: "number" },
      space_below_pt: { type: "number" },
      items: { type: "array", items: { type: "string" }, description: "List items." },
      rows: {
        type: "array",
        items: { type: "array", items: { type: "string" } },
        description: "Table rows (array of cell strings).",
      },
      url: { type: "string" },
      drive_file_id: { type: "string" },
      uri: { type: "string" },
      width_pt: { type: "number" },
      height_pt: { type: "number" },
    },
    required: ["type"],
    additionalProperties: true,
  } as PropertySchema;
}

export function parseDocsBlocksArg(raw: unknown): DocsBlock[] | { error: string } {
  let val = raw;
  if (typeof val === "string") {
    const s = val.trim();
    if (!s) return { error: "blocks must be a non-empty array" };
    try {
      val = JSON.parse(s) as unknown;
    } catch {
      return { error: "blocks string is not valid JSON — pass a JSON array of block objects" };
    }
  }
  if (val && typeof val === "object" && !Array.isArray(val)) {
    val = [val];
  }
  if (!Array.isArray(val) || val.length === 0) {
    return { error: "blocks must be a non-empty array of block objects" };
  }
  const normalized: DocsBlock[] = [];
  for (const item of val) {
    const block = normalizeDocsBlock(item);
    if (block) normalized.push(block);
  }
  if (normalized.length === 0) {
    return { error: "blocks must contain at least one valid block object" };
  }
  return normalized;
}

function normalizeDocsBlock(raw: unknown): DocsBlock | null {
  if (!raw || typeof raw !== "object") return null;
  const block = raw as Record<string, unknown>;
  const type = String(block.type ?? "").trim();
  if (type === "title") {
    return {
      type: "title",
      text: String(block.text ?? ""),
      alignment: parseAlignment(block.alignment),
    };
  }
  if (type === "subtitle") {
    return {
      type: "subtitle",
      text: String(block.text ?? ""),
      alignment: parseAlignment(block.alignment),
    };
  }
  if (type === "heading") {
    return {
      type: "heading",
      level: typeof block.level === "number" ? block.level : 1,
      text: String(block.text ?? ""),
      alignment: parseAlignment(block.alignment),
      color_hex: parseHexColor(block.color_hex),
      space_above_pt: parsePt(block.space_above_pt),
      space_below_pt: parsePt(block.space_below_pt),
    };
  }
  if (type === "paragraph") {
    return {
      type: "paragraph",
      text: String(block.text ?? ""),
      bold: block.bold === true,
      italic: block.italic === true,
      underline: block.underline === true,
      alignment: parseAlignment(block.alignment),
      color_hex: parseHexColor(block.color_hex),
      font_size_pt: parsePt(block.font_size_pt),
      space_above_pt: parsePt(block.space_above_pt),
      space_below_pt: parsePt(block.space_below_pt),
    };
  }
  if (type === "bullet_list" || type === "numbered_list") {
    const items = Array.isArray(block.items) ? block.items.map((i) => String(i)) : [];
    return { type, items };
  }
  if (type === "table") {
    let rows: unknown = block.rows;
    if (typeof rows === "string") {
      try {
        rows = JSON.parse(rows) as unknown;
      } catch {
        /* keep raw string — becomes single cell */
      }
    }
    return { type: "table", rows: normalizeTableRows(rows) };
  }
  if (type === "link") {
    return { type: "link", text: String(block.text ?? ""), url: String(block.url ?? "") };
  }
  if (type === "page_break") return { type: "page_break" };
  if (type === "divider") return { type: "divider" };
  if (type === "image") {
    return {
      type: "image",
      drive_file_id: typeof block.drive_file_id === "string" ? block.drive_file_id : undefined,
      uri: typeof block.uri === "string" ? block.uri : undefined,
      width_pt: typeof block.width_pt === "number" ? block.width_pt : undefined,
      height_pt: typeof block.height_pt === "number" ? block.height_pt : undefined,
    };
  }
  return null;
}

export function normalizeTableRows(rows: unknown): string[][] {
  if (!Array.isArray(rows) || rows.length === 0) return [[" "]];
  if (rows.every((r) => typeof r === "string")) {
    return [rows.map((c) => String(c))];
  }
  return rows.map((row) => {
    if (Array.isArray(row)) return row.map((c) => String(c ?? ""));
    return [String(row ?? "")];
  });
}

type DocsAlignment = "START" | "CENTER" | "END" | "JUSTIFIED";

function parseAlignment(raw: unknown): DocsAlignment | undefined {
  const v = String(raw ?? "").trim().toUpperCase();
  if (v === "START" || v === "CENTER" || v === "END" || v === "JUSTIFIED") return v;
  return undefined;
}

function parseHexColor(raw: unknown): string | undefined {
  const h = String(raw ?? "").trim().replace(/^#/, "");
  return /^[0-9a-fA-F]{6}$/.test(h) ? h : undefined;
}

function parsePt(raw: unknown): number | undefined {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
}

export type DocsBlock =
  | { type: "title"; text: string; alignment?: DocsAlignment }
  | { type: "subtitle"; text: string; alignment?: DocsAlignment }
  | {
      type: "heading";
      level: number;
      text: string;
      alignment?: DocsAlignment;
      color_hex?: string;
      space_above_pt?: number;
      space_below_pt?: number;
    }
  | {
      type: "paragraph";
      text: string;
      bold?: boolean;
      italic?: boolean;
      underline?: boolean;
      alignment?: DocsAlignment;
      color_hex?: string;
      font_size_pt?: number;
      space_above_pt?: number;
      space_below_pt?: number;
    }
  | { type: "bullet_list"; items: string[] }
  | { type: "numbered_list"; items: string[] }
  | { type: "table"; rows: string[][] }
  | { type: "page_break" }
  | { type: "divider" }
  | {
      type: "image";
      drive_file_id?: string;
      uri?: string;
      width_pt?: number;
      height_pt?: number;
    }
  | { type: "link"; text: string; url: string };

const HEADING_STYLES = [
  "HEADING_1",
  "HEADING_2",
  "HEADING_3",
  "HEADING_4",
  "HEADING_5",
  "HEADING_6",
] as const;

export function getBodyAppendIndex(doc: { body?: { content?: DocElement[] } }): number {
  const content = doc.body?.content ?? [];
  if (content.length === 0) return 1;
  const last = content[content.length - 1];
  const end = typeof last?.endIndex === "number" ? last.endIndex : 1;
  return Math.max(1, end - 1);
}

function paragraphText(el: DocElement): string {
  const runs = el.paragraph?.elements ?? [];
  return runs.map((r) => r.textRun?.content ?? "").join("");
}

export function extractDocumentText(doc: {
  title?: string;
  body?: { content?: DocElement[] };
}): { title: string; plain_text: string; outline: string[] } {
  const title = String(doc.title ?? "").trim();
  const lines: string[] = [];
  const outline: string[] = [];
  for (const el of doc.body?.content ?? []) {
    if (el.paragraph) {
      const text = paragraphText(el).replace(/\n$/, "");
      if (!text.trim()) continue;
      const style = el.paragraph.paragraphStyle?.namedStyleType ?? "";
      if (style === "TITLE") {
        lines.push(`# ${text}`);
        outline.push(text);
      } else if (style === "SUBTITLE") {
        lines.push(`## ${text}`);
        outline.push(`  ${text}`);
      } else if (style.startsWith("HEADING_")) {
        const level = parseInt(style.replace("HEADING_", ""), 10) || 1;
        const prefix = "#".repeat(Math.min(6, level));
        lines.push(`${prefix} ${text}`);
        outline.push(`${"  ".repeat(level - 1)}${text}`);
      } else if (el.paragraph.paragraphStyle?.bullet) {
        lines.push(`- ${text}`);
      } else {
        lines.push(text);
      }
    } else if (el.table) {
      const rows = el.table.tableRows ?? [];
      for (const row of rows) {
        const cells = (row.tableCells ?? []).map((cell) => {
          const parts = (cell.content ?? []).map((c) => (c.paragraph ? paragraphText(c).trim() : ""));
          return parts.join(" ").trim();
        });
        lines.push(`| ${cells.join(" | ")} |`);
      }
      lines.push("");
    } else if (el.sectionBreak) {
      lines.push("\n---\n");
    }
  }
  return { title, plain_text: lines.join("\n"), outline };
}

export function ptDimension(magnitude: number): { magnitude: number; unit: "PT" } {
  return { magnitude, unit: "PT" };
}

export function colorFromHex(hex?: string): { color: { rgbColor: { red: number; green: number; blue: number } } } | undefined {
  const h = String(hex ?? "").trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return undefined;
  return {
    color: {
      rgbColor: {
        red: parseInt(h.slice(0, 2), 16) / 255,
        green: parseInt(h.slice(2, 4), 16) / 255,
        blue: parseInt(h.slice(4, 6), 16) / 255,
      },
    },
  };
}

function buildParagraphStyleFields(style: Record<string, unknown>): string {
  return Object.keys(style).join(",");
}

function applyParagraphDecorations(
  requests: Record<string, unknown>[],
  insertStart: number,
  insertEnd: number,
  opts: {
    namedStyleType?: string;
    alignment?: DocsAlignment;
    space_above_pt?: number;
    space_below_pt?: number;
    borderBottom?: boolean;
  }
): void {
  const paragraphStyle: Record<string, unknown> = {};
  if (opts.namedStyleType) paragraphStyle.namedStyleType = opts.namedStyleType;
  if (opts.alignment) paragraphStyle.alignment = opts.alignment;
  if (typeof opts.space_above_pt === "number") paragraphStyle.spaceAbove = ptDimension(opts.space_above_pt);
  if (typeof opts.space_below_pt === "number") paragraphStyle.spaceBelow = ptDimension(opts.space_below_pt);
  if (opts.borderBottom) {
    const borderColor = colorFromHex("d0d0d0");
    paragraphStyle.borderBottom = {
      color: borderColor,
      width: ptDimension(1),
      padding: ptDimension(10),
      dashStyle: "SOLID",
    };
  }
  if (Object.keys(paragraphStyle).length === 0) return;
  requests.push({
    updateParagraphStyle: {
      range: { startIndex: insertStart, endIndex: insertEnd },
      paragraphStyle,
      fields: buildParagraphStyleFields(paragraphStyle),
    },
  });
}

function applyTextDecorations(
  requests: Record<string, unknown>[],
  insertStart: number,
  insertEnd: number,
  opts: {
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    color_hex?: string;
    font_size_pt?: number;
    link?: { url: string };
  }
): void {
  const textStyle: Record<string, unknown> = {};
  if (opts.bold) textStyle.bold = true;
  if (opts.italic) textStyle.italic = true;
  if (opts.underline) textStyle.underline = true;
  if (typeof opts.font_size_pt === "number") textStyle.fontSize = ptDimension(opts.font_size_pt);
  const fg = opts.color_hex ? colorFromHex(opts.color_hex) : undefined;
  if (fg) textStyle.foregroundColor = fg;
  if (opts.link) {
    textStyle.link = { url: opts.link.url };
    if (!fg) textStyle.foregroundColor = colorFromHex("1155cc");
  }
  if (Object.keys(textStyle).length === 0) return;
  requests.push({
    updateTextStyle: {
      range: { startIndex: insertStart, endIndex: insertEnd - 1 },
      textStyle,
      fields: buildTextStyleFields(textStyle),
    },
  });
}

export function buildTextStyleFields(style: Record<string, unknown>): string {
  return Object.keys(style).join(",");
}

export function buildRequestsForBlocks(
  blocks: DocsBlock[],
  startIndex: number
): { requests: Record<string, unknown>[]; tableBlocks: Array<{ blockIndex: number; rows: string[][] }> } {
  const requests: Record<string, unknown>[] = [];
  const tableBlocks: Array<{ blockIndex: number; rows: string[][] }> = [];
  let index = startIndex;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    if (block.type === "page_break") {
      requests.push({ insertPageBreak: { location: { index } } });
      index += 1;
      continue;
    }
    if (block.type === "divider") {
      const text = " \n";
      const insertStart = index;
      requests.push({ insertText: { location: { index }, text } });
      const insertEnd = index + text.length;
      index = insertEnd;
      applyParagraphDecorations(requests, insertStart, insertEnd, { borderBottom: true, space_below_pt: 6 });
      continue;
    }
    if (block.type === "image") {
      const uri =
        block.uri?.trim() ||
        (block.drive_file_id ? `https://drive.google.com/uc?id=${block.drive_file_id.trim()}` : "");
      if (!uri) continue;
      const objectSize: Record<string, unknown> = {};
      if (typeof block.width_pt === "number") objectSize.width = { magnitude: block.width_pt, unit: "PT" };
      if (typeof block.height_pt === "number") objectSize.height = { magnitude: block.height_pt, unit: "PT" };
      requests.push({
        insertInlineImage: {
          location: { index },
          uri,
          ...(Object.keys(objectSize).length ? { objectSize } : {}),
        },
      });
      index += 1;
      continue;
    }
    if (block.type === "table") {
      const normalized = normalizeTableRows(block.rows);
      requests.push(buildInsertTableRequest(index, normalized));
      tableBlocks.push({ blockIndex: i, rows: normalized });
      index += 1;
      continue;
    }

    let text = "";
    if (
      block.type === "title" ||
      block.type === "subtitle" ||
      block.type === "heading" ||
      block.type === "paragraph" ||
      block.type === "link"
    ) {
      text = block.text;
      if (!text.endsWith("\n")) text += "\n";
    } else if (block.type === "bullet_list" || block.type === "numbered_list") {
      text = block.items.map((item) => (item.endsWith("\n") ? item : `${item}\n`)).join("");
      if (!text) continue;
    } else {
      continue;
    }

    const insertStart = index;
    requests.push({ insertText: { location: { index }, text } });
    const insertEnd = index + text.length;
    index = insertEnd;

    if (block.type === "title") {
      applyParagraphDecorations(requests, insertStart, insertEnd, {
        namedStyleType: "TITLE",
        alignment: block.alignment ?? "CENTER",
        space_below_pt: 4,
      });
    }
    if (block.type === "subtitle") {
      applyParagraphDecorations(requests, insertStart, insertEnd, {
        namedStyleType: "SUBTITLE",
        alignment: block.alignment ?? "CENTER",
        space_below_pt: 12,
      });
      applyTextDecorations(requests, insertStart, insertEnd, { color_hex: "666666" });
    }
    if (block.type === "heading") {
      const level = Math.min(6, Math.max(1, Math.round(block.level)));
      applyParagraphDecorations(requests, insertStart, insertEnd, {
        namedStyleType: HEADING_STYLES[level - 1],
        alignment: block.alignment,
        space_above_pt: block.space_above_pt ?? (level === 1 ? 18 : 12),
        space_below_pt: block.space_below_pt ?? 6,
      });
      if (block.color_hex) {
        applyTextDecorations(requests, insertStart, insertEnd, { color_hex: block.color_hex });
      }
    }
    if (block.type === "paragraph") {
      applyParagraphDecorations(requests, insertStart, insertEnd, {
        alignment: block.alignment,
        space_above_pt: block.space_above_pt,
        space_below_pt: block.space_below_pt ?? 6,
      });
      applyTextDecorations(requests, insertStart, insertEnd, {
        bold: block.bold,
        italic: block.italic,
        underline: block.underline,
        color_hex: block.color_hex,
        font_size_pt: block.font_size_pt,
      });
    }
    if (block.type === "link") {
      applyTextDecorations(requests, insertStart, insertEnd, { link: { url: block.url } });
    }
    if (block.type === "bullet_list") {
      requests.push({
        createParagraphBullets: {
          range: { startIndex: insertStart, endIndex: insertEnd },
          bulletPreset: "BULLET_DISC_CIRCLE_SQUARE",
        },
      });
    }
    if (block.type === "numbered_list") {
      requests.push({
        createParagraphBullets: {
          range: { startIndex: insertStart, endIndex: insertEnd },
          bulletPreset: "NUMBERED_DECIMAL_NESTED",
        },
      });
    }
  }

  return { requests, tableBlocks };
}

export function listTablesInDocument(doc: { body?: { content?: DocElement[] } }): DocElement[] {
  return (doc.body?.content ?? []).filter((el) => el.table);
}

/** Index inside a table cell where insertText is valid (start of cell paragraph). */
export function getTableCellInsertIndex(cell: { content?: DocElement[] }): number | undefined {
  for (const el of cell.content ?? []) {
    const runs = el.paragraph?.elements;
    if (runs?.length) {
      const first = runs[0];
      if (typeof first?.startIndex === "number") return first.startIndex;
    }
    if (typeof el.startIndex === "number") return el.startIndex;
  }
  return undefined;
}

export type TableFillTarget = "last" | "first" | number;

/**
 * Build insertText requests for table cells. Inserts are sorted **descending** by index
 * (Google Docs API: indices in one batch are pre-shift; reverse order avoids collisions).
 */
export function buildTableCellInsertRequests(
  doc: { body?: { content?: DocElement[] } },
  rows: string[][],
  target: TableFillTarget = "last"
): Record<string, unknown>[] {
  const tables = listTablesInDocument(doc);
  if (tables.length === 0) return [];

  let tableEl: DocElement | undefined;
  if (target === "last") tableEl = tables[tables.length - 1];
  else if (target === "first") tableEl = tables[0];
  else tableEl = tables[target];
  if (!tableEl?.table) return [];

  const inserts: Array<{ index: number; text: string }> = [];
  const tableRows = tableEl.table.tableRows ?? [];
  for (let r = 0; r < tableRows.length && r < rows.length; r++) {
    const cells = tableRows[r]?.tableCells ?? [];
    const rowData = rows[r] ?? [];
    for (let c = 0; c < cells.length && c < rowData.length; c++) {
      const cellText = String(rowData[c] ?? "").trim();
      if (!cellText) continue;
      const index = getTableCellInsertIndex(cells[c] ?? {});
      if (typeof index !== "number") continue;
      const text = cellText.endsWith("\n") ? cellText : `${cellText}\n`;
      inserts.push({ index, text });
    }
  }

  inserts.sort((a, b) => b.index - a.index);
  return inserts.map(({ index, text }) => ({
    insertText: { location: { index }, text },
  }));
}

export function getTableStartIndex(tableEl: DocElement): number | undefined {
  return typeof tableEl.startIndex === "number" ? tableEl.startIndex : undefined;
}

export type TableStylePreset = "professional" | "plain";

export type TableStyleOptions = {
  preset?: TableStylePreset;
  headerBackgroundHex?: string;
  headerForegroundHex?: string;
  minRowHeightPt?: number;
};

/** Header row text styles (bold + light text on dark band). */
export function buildTableHeaderTextStyleRequests(
  tableEl: DocElement,
  foregroundHex = "ffffff"
): Record<string, unknown>[] {
  const headerRow = tableEl.table?.tableRows?.[0];
  if (!headerRow) return [];
  const requests: Record<string, unknown>[] = [];
  const fg = colorFromHex(foregroundHex);
  for (const cell of headerRow.tableCells ?? []) {
    for (const el of cell.content ?? []) {
      if (typeof el.startIndex !== "number" || typeof el.endIndex !== "number") continue;
      if (el.endIndex <= el.startIndex + 1) continue;
      requests.push({
        updateTextStyle: {
          range: { startIndex: el.startIndex, endIndex: el.endIndex - 1 },
          textStyle: { bold: true, ...(fg ? { foregroundColor: fg } : {}) },
          fields: fg ? "bold,foregroundColor" : "bold",
        },
      });
    }
  }
  return requests;
}

/** @deprecated Use buildTableHeaderTextStyleRequests */
export function buildTableHeaderBoldRequests(tableEl: DocElement): Record<string, unknown>[] {
  return buildTableHeaderTextStyleRequests(tableEl);
}

/** Table banding, header row, column widths — applied after cells are filled. */
export function buildTablePolishRequests(
  tableEl: DocElement,
  colCount: number,
  opts: TableStyleOptions = {}
): Record<string, unknown>[] {
  if (opts.preset === "plain") return [];
  const start = getTableStartIndex(tableEl);
  if (start === undefined || colCount < 1) return [];

  const headerBg = opts.headerBackgroundHex ?? "2d3748";
  const requests: Record<string, unknown>[] = [];

  requests.push({
    updateTableRowStyle: {
      tableStartLocation: { index: start },
      rowIndices: [0],
      tableRowStyle: {
        tableHeader: true,
        minRowHeight: ptDimension(opts.minRowHeightPt ?? 28),
      },
      fields: "tableHeader,minRowHeight",
    },
  });

  for (let c = 0; c < colCount; c++) {
    const cellStyle: Record<string, unknown> = {
      paddingTop: ptDimension(6),
      paddingBottom: ptDimension(6),
      paddingLeft: ptDimension(8),
      paddingRight: ptDimension(8),
    };
    const bg = colorFromHex(headerBg);
    if (bg) cellStyle.backgroundColor = bg;
    requests.push({
      updateTableCellStyle: {
        tableCellStyle: cellStyle,
        fields: Object.keys(cellStyle).join(","),
        tableRange: {
          tableCellLocation: {
            tableStartLocation: { index: start },
            rowIndex: 0,
            columnIndex: c,
          },
          rowSpan: 1,
          columnSpan: 1,
        },
      },
    });
  }

  const rowCount = tableEl.table?.tableRows?.length ?? 0;
  for (let r = 1; r < rowCount; r++) {
    if (r % 2 !== 0) continue;
    for (let c = 0; c < colCount; c++) {
      const stripe = colorFromHex("f7fafc");
      if (!stripe) continue;
      requests.push({
        updateTableCellStyle: {
          tableCellStyle: { backgroundColor: stripe },
          fields: "backgroundColor",
          tableRange: {
            tableCellLocation: {
              tableStartLocation: { index: start },
              rowIndex: r,
              columnIndex: c,
            },
            rowSpan: 1,
            columnSpan: 1,
          },
        },
      });
    }
  }

  requests.push({
    updateTableColumnProperties: {
      tableStartLocation: { index: start },
      columnIndices: Array.from({ length: colCount }, (_, i) => i),
      tableColumnProperties: { widthType: "EVENLY_DISTRIBUTED" },
      fields: "widthType",
    },
  });

  return requests;
}

export function buildDocumentStyleRequests(opts: {
  margin_top_pt?: number;
  margin_bottom_pt?: number;
  margin_left_pt?: number;
  margin_right_pt?: number;
  background_color_hex?: string;
}): Record<string, unknown>[] {
  const documentStyle: Record<string, unknown> = {};
  const fields: string[] = [];
  if (typeof opts.margin_top_pt === "number") {
    documentStyle.marginTop = ptDimension(opts.margin_top_pt);
    fields.push("marginTop");
  }
  if (typeof opts.margin_bottom_pt === "number") {
    documentStyle.marginBottom = ptDimension(opts.margin_bottom_pt);
    fields.push("marginBottom");
  }
  if (typeof opts.margin_left_pt === "number") {
    documentStyle.marginLeft = ptDimension(opts.margin_left_pt);
    fields.push("marginLeft");
  }
  if (typeof opts.margin_right_pt === "number") {
    documentStyle.marginRight = ptDimension(opts.margin_right_pt);
    fields.push("marginRight");
  }
  const bg = opts.background_color_hex ? colorFromHex(opts.background_color_hex) : undefined;
  if (bg) {
    documentStyle.background = { color: bg };
    fields.push("background");
  }
  if (fields.length === 0) return [];
  return [{ updateDocumentStyle: { documentStyle, fields: fields.join(",") } }];
}

export function buildInsertTableRequest(
  index: number,
  rows: string[][],
  normalized = normalizeTableRows(rows)
): Record<string, unknown> {
  const rowCount = Math.max(1, normalized.length);
  const colCount = Math.max(1, ...normalized.map((r) => r.length), 1);
  return {
    insertTable: {
      location: { index },
      rows: rowCount,
      columns: colCount,
    },
  };
}

export async function uploadDriveImage(
  data: Buffer,
  filename: string,
  mimeType: string
): Promise<{ ok: true; fileId: string } | { ok: false; error: string }> {
  const boundary = `liminal-${Date.now()}`;
  const meta = JSON.stringify({ name: filename, mimeType });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
    data,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const res = await googleOfficeApiJson<{ id?: string }>(
    DRIVE_BASE,
    "Drive API",
    "/files?uploadType=multipart&fields=id",
    {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    }
  );
  if (!res.ok) return res;
  const fileId = String(res.data.id ?? "").trim();
  if (!fileId) return { ok: false, error: "Drive upload returned no file id" };
  return { ok: true, fileId };
}

export async function loadImageBytes(
  spec: Record<string, unknown>
): Promise<{ ok: true; data: Buffer; filename: string; mimeType: string } | { ok: false; error: string }> {
  const path = String(spec["path"] ?? "").trim();
  const b64 = String(spec["data_base64"] ?? "").trim();
  const mimeHint = String(spec["mime_type"] ?? "").trim();
  if (path) {
    const data = await readFile(path);
    const filename = basename(path);
    const mimeType = mimeHint || guessImageMime(filename);
    return { ok: true, data, filename, mimeType };
  }
  if (b64) {
    const data = Buffer.from(b64, "base64");
    const filename = String(spec["filename"] ?? "image.png").trim() || "image.png";
    return { ok: true, data, filename, mimeType: mimeHint || guessImageMime(filename) };
  }
  return { ok: false, error: "image requires path or data_base64" };
}

function guessImageMime(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/png";
}
