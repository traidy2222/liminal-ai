/**
 * Google Docs REST — rich document read/write via docs.googleapis.com + Drive.
 */
import type { ToolDefinition, ToolResult } from "@liminal/core";
import { defineTool } from "./helpers.js";
import {
  DOCS_BASE,
  DRIVE_BASE,
  arraySchema,
  googleOfficeApiJson,
  objectSchema,
  qs,
} from "./google_office_rest_shared.js";
import {
  buildDocumentStyleRequests,
  buildInsertTableRequest,
  buildRequestsForBlocks,
  buildTableCellInsertRequests,
  buildTableHeaderTextStyleRequests,
  buildTablePolishRequests,
  buildTextStyleFields,
  docsBlocksFieldSchema,
  extractDocumentText,
  getBodyAppendIndex,
  listTablesInDocument,
  loadImageBytes,
  normalizeTableRows,
  parseDocsBlocksArg,
  type TableStylePreset,
  uploadDriveImage,
} from "./google_docs_build.js";

function jsonResult(data: unknown): ToolResult {
  return { ok: true, output: JSON.stringify(data, null, 2) };
}

type DocBody = { body?: { content?: unknown[] } };

async function getDocBody(documentId: string): Promise<{ ok: true; data: DocBody } | { ok: false; error: string }> {
  return googleOfficeApiJson<DocBody>(DOCS_BASE, "Docs API", `/documents/${encodeURIComponent(documentId)}`);
}

async function fillTableCells(
  documentId: string,
  rows: string[][],
  opts?: { headerBold?: boolean; stylePreset?: TableStylePreset }
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const getRes = await getDocBody(documentId);
  if (!getRes.ok) return getRes;
  const cellRequests = buildTableCellInsertRequests(
    getRes.data as Parameters<typeof buildTableCellInsertRequests>[0],
    rows,
    "last"
  );
  if (cellRequests.length === 0) return { ok: true, data: {} };
  const cellRes = await docsBatchUpdate(documentId, cellRequests);
  if (!cellRes.ok) return cellRes;

  const stylePreset = opts?.stylePreset ?? "professional";
  const colCount = Math.max(1, ...rows.map((r) => r.length));
  const styleRequests: Record<string, unknown>[] = [];

  if (stylePreset !== "plain") {
    const getRes2 = await getDocBody(documentId);
    if (!getRes2.ok) return getRes2;
    const tables = listTablesInDocument(getRes2.data as Parameters<typeof listTablesInDocument>[0]);
    const lastTable = tables[tables.length - 1];
    if (lastTable) {
      styleRequests.push(...buildTablePolishRequests(lastTable, colCount, { preset: stylePreset }));
      if (opts?.headerBold !== false) {
        styleRequests.push(...buildTableHeaderTextStyleRequests(lastTable));
      }
    }
  } else if (opts?.headerBold !== false) {
    const getRes2 = await getDocBody(documentId);
    if (!getRes2.ok) return getRes2;
    const tables = listTablesInDocument(getRes2.data as Parameters<typeof listTablesInDocument>[0]);
    const lastTable = tables[tables.length - 1];
    if (lastTable) styleRequests.push(...buildTableHeaderTextStyleRequests(lastTable, "000000"));
  }

  if (styleRequests.length === 0) return cellRes;
  const styleRes = await docsBatchUpdate(documentId, styleRequests);
  if (!styleRes.ok) return styleRes;
  return { ok: true, data: { cells: cellRes.data, style: styleRes.data } };
}

async function docsBatchUpdate(
  documentId: string,
  requests: Record<string, unknown>[],
  writeControl?: unknown
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const body: Record<string, unknown> = { requests };
  if (writeControl && typeof writeControl === "object") body.writeControl = writeControl;
  return googleOfficeApiJson<unknown>(
    DOCS_BASE,
    "Docs API",
    `/documents/${encodeURIComponent(documentId)}:batchUpdate`,
    { method: "POST", body: JSON.stringify(body) }
  );
}

export function createGoogleDocsRestTools(): ToolDefinition[] {
  const docsRestGetDocument = defineTool({
    name: "docs_rest_get_document",
    description:
      "WHAT: Fetch full Google Doc JSON (structure, tables, inline images, styles, headers).\n" +
      "WHEN: Planning batchUpdate indices or inspecting layout — prefer docs_rest_extract_text for reading prose.",
    parameters: {
      type: "object",
      properties: {
        document_id: { type: "string", description: "Google Doc file id." },
        suggestions_view_mode: {
          type: "string",
          enum: [
            "DEFAULT_FOR_CURRENT_ACCESS",
            "SUGGESTIONS_INLINE",
            "PREVIEW_SUGGESTIONS_ACCEPTED",
            "PREVIEW_WITHOUT_SUGGESTIONS",
          ],
        },
        include_tabs_content: { type: "boolean" },
      },
      required: ["document_id"],
      additionalProperties: false,
    },
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 15_000,
    handler: async (args): Promise<ToolResult> => {
      const id = String(args["document_id"] ?? "").trim();
      if (!id) return { ok: false, error: "document_id is required" };
      const q = qs({
        suggestionsViewMode: String(args["suggestions_view_mode"] ?? "").trim() || undefined,
        includeTabsContent: args["include_tabs_content"] === true ? true : undefined,
      });
      const res = await googleOfficeApiJson<unknown>(
        DOCS_BASE,
        "Docs API",
        `/documents/${encodeURIComponent(id)}${q}`
      );
      if (!res.ok) return { ok: false, error: res.error };
      return jsonResult(res.data);
    },
  });

  const docsRestExtractText = defineTool({
    name: "docs_rest_extract_text",
    description:
      "WHAT: Read a Doc as plain text with headings, bullets, and tables (markdown-ish).\n" +
      "WHEN: User asks what's in a doc — faster than full JSON. Use get_document when you need indices or structure.",
    parameters: {
      type: "object",
      properties: {
        document_id: { type: "string" },
      },
      required: ["document_id"],
      additionalProperties: false,
    },
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 15_000,
    handler: async (args): Promise<ToolResult> => {
      const id = String(args["document_id"] ?? "").trim();
      if (!id) return { ok: false, error: "document_id is required" };
      const res = await googleOfficeApiJson<{ title?: string; body?: unknown }>(
        DOCS_BASE,
        "Docs API",
        `/documents/${encodeURIComponent(id)}`
      );
      if (!res.ok) return { ok: false, error: res.error };
      return jsonResult(extractDocumentText(res.data as Parameters<typeof extractDocumentText>[0]));
    },
  });

  const docsRestCreateDocument = defineTool({
    name: "docs_rest_create_document",
    description:
      "WHAT: Create a blank Google Doc (documents.create).\n" +
      "WHEN: New doc — follow with docs_rest_write_blocks for rich content (title/subtitle blocks, headings, lists, tables, images).\n" +
      "TIP: Set apply_default_style=true for 1-inch margins suitable for reports.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Document title." },
        apply_default_style: {
          type: "boolean",
          description: "Apply 72pt margins on all sides (default false).",
        },
      },
      additionalProperties: false,
    },
    requiresApproval: true,
    dangerLevel: "destructive",
    handler: async (args): Promise<ToolResult> => {
      const title = String(args["title"] ?? "").trim();
      const body = title ? { title } : {};
      const res = await googleOfficeApiJson<{ documentId?: string }>(DOCS_BASE, "Docs API", "/documents", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) return { ok: false, error: res.error };
      const docId = String(res.data.documentId ?? "").trim();
      if (args["apply_default_style"] === true && docId) {
        const styleReqs = buildDocumentStyleRequests({
          margin_top_pt: 72,
          margin_bottom_pt: 72,
          margin_left_pt: 72,
          margin_right_pt: 72,
        });
        const styleRes = await docsBatchUpdate(docId, styleReqs);
        if (!styleRes.ok) return { ok: false, error: styleRes.error };
        return jsonResult({ ...res.data, documentStyle: styleRes.data });
      }
      return jsonResult(res.data);
    },
  });

  const docsRestSetDocumentStyle = defineTool({
    name: "docs_rest_set_document_style",
    description:
      "WHAT: Set document-level page style — margins, background color.\n" +
      "WHEN: Polish a report/proposal before export; use after create_document or on templates.",
    parameters: {
      type: "object",
      properties: {
        document_id: { type: "string" },
        margin_top_pt: { type: "number" },
        margin_bottom_pt: { type: "number" },
        margin_left_pt: { type: "number" },
        margin_right_pt: { type: "number" },
        background_color_hex: { type: "string", description: "Page background e.g. #ffffff." },
      },
      required: ["document_id"],
      additionalProperties: false,
    },
    requiresApproval: true,
    dangerLevel: "destructive",
    handler: async (args): Promise<ToolResult> => {
      const id = String(args["document_id"] ?? "").trim();
      if (!id) return { ok: false, error: "document_id is required" };
      const requests = buildDocumentStyleRequests({
        margin_top_pt: typeof args["margin_top_pt"] === "number" ? args["margin_top_pt"] : undefined,
        margin_bottom_pt: typeof args["margin_bottom_pt"] === "number" ? args["margin_bottom_pt"] : undefined,
        margin_left_pt: typeof args["margin_left_pt"] === "number" ? args["margin_left_pt"] : undefined,
        margin_right_pt: typeof args["margin_right_pt"] === "number" ? args["margin_right_pt"] : undefined,
        background_color_hex: String(args["background_color_hex"] ?? "").trim() || undefined,
      });
      if (requests.length === 0) {
        return { ok: false, error: "specify at least one style property (margins or background)" };
      }
      const res = await docsBatchUpdate(id, requests);
      if (!res.ok) return { ok: false, error: res.error };
      return jsonResult(res.data);
    },
  });

  const docsRestCopyDocument = defineTool({
    name: "docs_rest_copy_document",
    description:
      "WHAT: Duplicate a Google Doc via Drive files.copy (templates, letterhead, reports).\n" +
      "WHEN: User has a template doc id — returns new documentId for editing.",
    parameters: {
      type: "object",
      properties: {
        source_document_id: { type: "string", description: "Drive file id of doc to copy." },
        title: { type: "string", description: "Title for the copy." },
        folder_id: { type: "string", description: "Optional Drive folder id for the new file." },
      },
      required: ["source_document_id"],
      additionalProperties: false,
    },
    requiresApproval: true,
    dangerLevel: "destructive",
    handler: async (args): Promise<ToolResult> => {
      const sourceId = String(args["source_document_id"] ?? "").trim();
      if (!sourceId) return { ok: false, error: "source_document_id is required" };
      const body: Record<string, unknown> = {};
      const title = String(args["title"] ?? "").trim();
      const folderId = String(args["folder_id"] ?? "").trim();
      if (title) body.name = title;
      if (folderId) body.parents = [folderId];
      const res = await googleOfficeApiJson<{ id?: string; name?: string }>(
        DRIVE_BASE,
        "Drive API",
        `/files/${encodeURIComponent(sourceId)}/copy?fields=id,name,mimeType,webViewLink`,
        { method: "POST", body: JSON.stringify(body) }
      );
      if (!res.ok) return { ok: false, error: res.error };
      return jsonResult(res.data);
    },
  });

  const docsRestWriteBlocks = defineTool({
    name: "docs_rest_write_blocks",
    description:
      "WHAT: Append rich content blocks — title/subtitle, headings (1–6), paragraphs (bold/italic/align/color), bullet/numbered lists, tables, links, images, dividers, page breaks.\n" +
      "WHEN: **Preferred write path** for formatted docs — not plain insertText only.\n" +
      "HOW: Pass `blocks` as a **JSON array** of objects (not a string). Defaults to append at end.\n" +
      "Image blocks: `drive_file_id` or `uri`. For local images use docs_rest_insert_image first.",
    parameters: {
      type: "object",
      properties: {
        document_id: { type: "string" },
        blocks: docsBlocksFieldSchema(),
        append_to_end: {
          type: "boolean",
          description: "Append after body content (default true). If false, use insert_index.",
        },
        insert_index: {
          type: "number",
          description: "Explicit Docs API index to insert at (advanced).",
        },
      },
      required: ["document_id", "blocks"],
      additionalProperties: false,
    },
    requiresApproval: true,
    dangerLevel: "destructive",
    handler: async (args): Promise<ToolResult> => {
      const id = String(args["document_id"] ?? "").trim();
      if (!id) return { ok: false, error: "document_id is required" };
      const parsedBlocks = parseDocsBlocksArg(args["blocks"]);
      if ("error" in parsedBlocks) return { ok: false, error: parsedBlocks.error };
      const blocks = parsedBlocks;

      let insertIndex = typeof args["insert_index"] === "number" ? args["insert_index"] : undefined;
      const append = args["append_to_end"] !== false;
      if (insertIndex === undefined && append) {
        const getRes = await googleOfficeApiJson<{ body?: { content?: unknown[] } }>(
          DOCS_BASE,
          "Docs API",
          `/documents/${encodeURIComponent(id)}`
        );
        if (!getRes.ok) return { ok: false, error: getRes.error };
        insertIndex = getBodyAppendIndex(getRes.data as Parameters<typeof getBodyAppendIndex>[0]);
      }
      if (insertIndex === undefined) return { ok: false, error: "insert_index is required when append_to_end is false" };

      // Apply block-by-block so indices stay correct (tables change document length unpredictably).
      let index = insertIndex;
      const results: unknown[] = [];
      for (const block of blocks) {
        const { requests, tableBlocks } = buildRequestsForBlocks([block], index);
        if (requests.length === 0) continue;
        const batchRes = await docsBatchUpdate(id, requests);
        if (!batchRes.ok) return { ok: false, error: batchRes.error };
        results.push(batchRes.data);

        if (block.type === "table") {
          const tableRows = normalizeTableRows(block.rows);
          const fillRes = await fillTableCells(id, tableRows, { headerBold: true });
          if (!fillRes.ok) return { ok: false, error: fillRes.error };
          results.push(fillRes.data);
        }

        const getRes3 = await googleOfficeApiJson<{ body?: { content?: unknown[] } }>(
          DOCS_BASE,
          "Docs API",
          `/documents/${encodeURIComponent(id)}`
        );
        if (!getRes3.ok) return { ok: false, error: getRes3.error };
        index = getBodyAppendIndex(getRes3.data as Parameters<typeof getBodyAppendIndex>[0]);
      }
      return jsonResult(results.length === 1 ? results[0] : results);
    },
  });

  const docsRestInsertTable = defineTool({
    name: "docs_rest_insert_table",
    description:
      "WHAT: Insert a formatted table at the end of a Doc (preferred for data grids).\n" +
      "WHEN: Feature matrices, comparisons, schedules — clearer than cramming into one table block.\n" +
      "HOW: `rows` is 2D array; row 0 gets professional header band (dark bg, white bold text) by default.",
    parameters: {
      type: "object",
      properties: {
        document_id: { type: "string" },
        rows: {
          type: "array",
          description: "2D array of cell strings. First row = header.",
          items: { type: "array", items: { type: "string" } },
        },
        header_bold: { type: "boolean", description: "Bold first row (default true)." },
        style_preset: {
          type: "string",
          enum: ["professional", "plain"],
          description: "professional = header band, zebra rows, even columns (default).",
        },
        append_to_end: { type: "boolean", description: "Append at document end (default true)." },
        insert_index: { type: "number", description: "Explicit index when append_to_end is false." },
      },
      required: ["document_id", "rows"],
      additionalProperties: false,
    },
    requiresApproval: true,
    dangerLevel: "destructive",
    handler: async (args): Promise<ToolResult> => {
      const id = String(args["document_id"] ?? "").trim();
      if (!id) return { ok: false, error: "document_id is required" };
      const rows = normalizeTableRows(args["rows"]);
      let insertIndex = typeof args["insert_index"] === "number" ? args["insert_index"] : undefined;
      if (insertIndex === undefined && args["append_to_end"] !== false) {
        const getRes = await getDocBody(id);
        if (!getRes.ok) return { ok: false, error: getRes.error };
        insertIndex = getBodyAppendIndex(getRes.data as Parameters<typeof getBodyAppendIndex>[0]);
      }
      if (insertIndex === undefined) return { ok: false, error: "insert_index required when append_to_end is false" };

      const tableRes = await docsBatchUpdate(id, [buildInsertTableRequest(insertIndex, rows)]);
      if (!tableRes.ok) return { ok: false, error: tableRes.error };

      const stylePreset =
        args["style_preset"] === "plain" ? "plain" : ("professional" as TableStylePreset);
      const fillRes = await fillTableCells(id, rows, {
        headerBold: args["header_bold"] !== false,
        stylePreset,
      });
      if (!fillRes.ok) return { ok: false, error: fillRes.error };
      return jsonResult({ table: tableRes.data, fill: fillRes.data });
    },
  });

  const docsRestInsertImage = defineTool({
    name: "docs_rest_insert_image",
    description:
      "WHAT: Upload an image to Drive (if needed) and insert inline in a Doc.\n" +
      "WHEN: Logo, diagram, photo in a document. Supports local path, base64, existing drive_file_id, or public uri.",
    parameters: {
      type: "object",
      properties: {
        document_id: { type: "string" },
        drive_file_id: { type: "string", description: "Existing Drive image file id." },
        uri: { type: "string", description: "Public image URL (Google fetches it)." },
        path: { type: "string", description: "Local image path to upload." },
        data_base64: { type: "string" },
        filename: { type: "string" },
        mime_type: { type: "string" },
        width_pt: { type: "number" },
        height_pt: { type: "number" },
        insert_index: { type: "number", description: "Docs index; default append to end." },
      },
      required: ["document_id"],
      additionalProperties: false,
    },
    requiresApproval: true,
    dangerLevel: "destructive",
    handler: async (args): Promise<ToolResult> => {
      const docId = String(args["document_id"] ?? "").trim();
      if (!docId) return { ok: false, error: "document_id is required" };

      let driveFileId = String(args["drive_file_id"] ?? "").trim();
      let uri = String(args["uri"] ?? "").trim();

      if (!driveFileId && !uri) {
        const loaded = await loadImageBytes(args);
        if (!loaded.ok) return { ok: false, error: loaded.error };
        const uploaded = await uploadDriveImage(loaded.data, loaded.filename, loaded.mimeType);
        if (!uploaded.ok) return { ok: false, error: uploaded.error };
        driveFileId = uploaded.fileId;
      }

      if (!uri && driveFileId) uri = `https://drive.google.com/uc?id=${driveFileId}`;
      if (!uri) return { ok: false, error: "provide drive_file_id, uri, path, or data_base64" };

      let insertIndex = typeof args["insert_index"] === "number" ? args["insert_index"] : undefined;
      if (insertIndex === undefined) {
        const getRes = await googleOfficeApiJson<{ body?: { content?: unknown[] } }>(
          DOCS_BASE,
          "Docs API",
          `/documents/${encodeURIComponent(docId)}`
        );
        if (!getRes.ok) return { ok: false, error: getRes.error };
        insertIndex = getBodyAppendIndex(getRes.data as Parameters<typeof getBodyAppendIndex>[0]);
      }

      const objectSize: Record<string, unknown> = {};
      if (typeof args["width_pt"] === "number") objectSize.width = { magnitude: args["width_pt"], unit: "PT" };
      if (typeof args["height_pt"] === "number") objectSize.height = { magnitude: args["height_pt"], unit: "PT" };

      const res = await docsBatchUpdate(docId, [
        {
          insertInlineImage: {
            location: { index: insertIndex },
            uri,
            ...(Object.keys(objectSize).length ? { objectSize } : {}),
          },
        },
      ]);
      if (!res.ok) return { ok: false, error: res.error };
      return jsonResult({ ...((res.data as object) ?? {}), drive_file_id: driveFileId || undefined, uri });
    },
  });

  const docsRestReplaceAllText = defineTool({
    name: "docs_rest_replace_all_text",
    description:
      "WHAT: Find/replace across the whole Doc (replaceAllText) — preserves structure outside matched text.\n" +
      "WHEN: Update placeholders like {{NAME}} or fix repeated phrases.",
    parameters: {
      type: "object",
      properties: {
        document_id: { type: "string" },
        find: { type: "string" },
        replace: { type: "string" },
        match_case: { type: "boolean" },
      },
      required: ["document_id", "find", "replace"],
      additionalProperties: false,
    },
    requiresApproval: true,
    dangerLevel: "destructive",
    handler: async (args): Promise<ToolResult> => {
      const id = String(args["document_id"] ?? "").trim();
      const find = String(args["find"] ?? "");
      const replace = String(args["replace"] ?? "");
      if (!id || !find) return { ok: false, error: "document_id and find are required" };
      const res = await docsBatchUpdate(id, [
        {
          replaceAllText: {
            containsText: { text: find, matchCase: args["match_case"] === true },
            replaceText: replace,
          },
        },
      ]);
      if (!res.ok) return { ok: false, error: res.error };
      return jsonResult(res.data);
    },
  });

  const docsRestFormatRange = defineTool({
    name: "docs_rest_format_range",
    description:
      "WHAT: Apply text and/or paragraph styles to an index range (bold, color, font, alignment, heading style).\n" +
      "WHEN: Fine-tune formatting after write_blocks — indices from docs_rest_get_document.",
    parameters: {
      type: "object",
      properties: {
        document_id: { type: "string" },
        start_index: { type: "number" },
        end_index: { type: "number" },
        bold: { type: "boolean" },
        italic: { type: "boolean" },
        underline: { type: "boolean" },
        strikethrough: { type: "boolean" },
        font_size_pt: { type: "number" },
        font_family: { type: "string" },
        foreground_color_hex: { type: "string", description: "e.g. #1155cc" },
        background_color_hex: { type: "string" },
        heading_level: { type: "number", description: "1–6 sets named heading style on paragraph range." },
        alignment: { type: "string", enum: ["START", "CENTER", "END", "JUSTIFIED"] },
      },
      required: ["document_id", "start_index", "end_index"],
      additionalProperties: false,
    },
    requiresApproval: true,
    dangerLevel: "destructive",
    handler: async (args): Promise<ToolResult> => {
      const id = String(args["document_id"] ?? "").trim();
      const start = args["start_index"];
      const end = args["end_index"];
      if (!id || typeof start !== "number" || typeof end !== "number") {
        return { ok: false, error: "document_id, start_index, and end_index are required" };
      }
      const requests: Record<string, unknown>[] = [];
      const textStyle: Record<string, unknown> = {};
      if (args["bold"] === true) textStyle.bold = true;
      if (args["italic"] === true) textStyle.italic = true;
      if (args["underline"] === true) textStyle.underline = true;
      if (args["strikethrough"] === true) textStyle.strikethrough = true;
      if (typeof args["font_size_pt"] === "number") {
        textStyle.fontSize = { magnitude: args["font_size_pt"], unit: "PT" };
      }
      if (typeof args["font_family"] === "string" && args["font_family"].trim()) {
        textStyle.weightedFontFamily = { fontFamily: args["font_family"].trim() };
      }
      const fg = String(args["foreground_color_hex"] ?? "").trim();
      const bg = String(args["background_color_hex"] ?? "").trim();
      if (/^#?[0-9a-fA-F]{6}$/.test(fg)) {
        const h = fg.replace(/^#/, "");
        textStyle.foregroundColor = {
          color: {
            rgbColor: {
              red: parseInt(h.slice(0, 2), 16) / 255,
              green: parseInt(h.slice(2, 4), 16) / 255,
              blue: parseInt(h.slice(4, 6), 16) / 255,
            },
          },
        };
      }
      if (/^#?[0-9a-fA-F]{6}$/.test(bg)) {
        const h = bg.replace(/^#/, "");
        textStyle.backgroundColor = {
          color: {
            rgbColor: {
              red: parseInt(h.slice(0, 2), 16) / 255,
              green: parseInt(h.slice(2, 4), 16) / 255,
              blue: parseInt(h.slice(4, 6), 16) / 255,
            },
          },
        };
      }
      if (Object.keys(textStyle).length > 0) {
        requests.push({
          updateTextStyle: {
            range: { startIndex: start, endIndex: end },
            textStyle,
            fields: buildTextStyleFields(textStyle),
          },
        });
      }
      const paraStyle: Record<string, unknown> = {};
      if (typeof args["heading_level"] === "number") {
        const level = Math.min(6, Math.max(1, Math.round(args["heading_level"])));
        paraStyle.namedStyleType = `HEADING_${level}`;
      }
      const align = String(args["alignment"] ?? "").trim();
      if (align) paraStyle.alignment = align;
      if (Object.keys(paraStyle).length > 0) {
        requests.push({
          updateParagraphStyle: {
            range: { startIndex: start, endIndex: end },
            paragraphStyle: paraStyle,
            fields: Object.keys(paraStyle).join(","),
          },
        });
      }
      if (requests.length === 0) return { ok: false, error: "specify at least one style property" };
      const res = await docsBatchUpdate(id, requests);
      if (!res.ok) return { ok: false, error: res.error };
      return jsonResult(res.data);
    },
  });

  const docsRestDeleteContent = defineTool({
    name: "docs_rest_delete_content",
    description:
      "WHAT: Delete a range of document content by index (deleteContentRange).\n" +
      "WHEN: Remove a section — get indices from docs_rest_get_document.",
    parameters: {
      type: "object",
      properties: {
        document_id: { type: "string" },
        start_index: { type: "number" },
        end_index: { type: "number" },
      },
      required: ["document_id", "start_index", "end_index"],
      additionalProperties: false,
    },
    requiresApproval: true,
    dangerLevel: "destructive",
    handler: async (args): Promise<ToolResult> => {
      const id = String(args["document_id"] ?? "").trim();
      const start = args["start_index"];
      const end = args["end_index"];
      if (!id || typeof start !== "number" || typeof end !== "number") {
        return { ok: false, error: "document_id, start_index, and end_index are required" };
      }
      const res = await docsBatchUpdate(id, [{ deleteContentRange: { range: { startIndex: start, endIndex: end } } }]);
      if (!res.ok) return { ok: false, error: res.error };
      return jsonResult(res.data);
    },
  });

  const docsRestBatchUpdate = defineTool({
    name: "docs_rest_batch_update",
    description:
      "WHAT: Raw Docs batchUpdate — escape hatch for headers/footers, merge cells, named ranges, suggestions, etc.\n" +
      "WHEN: write_blocks/format_range are not enough. See Google Docs API Request reference.\n" +
      "PREFER: docs_rest_write_blocks for headings, lists, tables, links, images.",
    parameters: {
      type: "object",
      properties: {
        document_id: { type: "string" },
        requests: arraySchema("Docs API Request objects."),
        write_control: objectSchema("Optional WriteControl."),
      },
      required: ["document_id", "requests"],
      additionalProperties: false,
    },
    requiresApproval: true,
    dangerLevel: "destructive",
    handler: async (args): Promise<ToolResult> => {
      const id = String(args["document_id"] ?? "").trim();
      if (!id) return { ok: false, error: "document_id is required" };
      if (!Array.isArray(args["requests"]) || args["requests"].length === 0) {
        return { ok: false, error: "requests array is required and must not be empty" };
      }
      const res = await docsBatchUpdate(
        id,
        args["requests"] as Record<string, unknown>[],
        args["write_control"]
      );
      if (!res.ok) return { ok: false, error: res.error };
      return jsonResult(res.data);
    },
  });

  return [
    docsRestGetDocument,
    docsRestExtractText,
    docsRestCreateDocument,
    docsRestSetDocumentStyle,
    docsRestCopyDocument,
    docsRestWriteBlocks,
    docsRestInsertTable,
    docsRestInsertImage,
    docsRestReplaceAllText,
    docsRestFormatRange,
    docsRestDeleteContent,
    docsRestBatchUpdate,
  ];
}
