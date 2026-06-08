/**
 * Google Docs / Sheets / Slides REST registration — complements mcp_google_ext_* (workspace-mcp).
 */
import type { ToolDefinition } from "@liminal/core";
import { createGoogleDocsRestTools } from "./google_docs_rest.js";
import { createGoogleSheetsRestTools } from "./google_sheets_rest.js";
import { createGoogleSlidesRestTools } from "./google_slides_rest.js";
import { officeRestEnabled } from "./google_office_rest_shared.js";
import { defineTool } from "./helpers.js";
import type { ToolResult } from "@liminal/core";
import { writeFile } from "node:fs/promises";
import { DRIVE_BASE, googleOfficeApiBinary, qs } from "./google_office_rest_shared.js";

export { officeRestEnabled } from "./google_office_rest_shared.js";

function createOfficeExportTool(): ToolDefinition {
  return defineTool({
    name: "office_rest_export_file",
    description:
      "WHAT: Export a Google Doc/Sheet/Slide to PDF, Office format, CSV, or plain text (Drive files.export).\n" +
      "WHEN: User wants a downloadable file — pass file_id and mime_type.\n" +
      "Common mime_type: application/pdf; Docs: text/plain; Sheets: text/csv; Slides: application/vnd.openxmlformats-officedocument.presentationml.presentation.\n" +
      "Set output_path to write bytes to disk; otherwise returns base64.",
    parameters: {
      type: "object",
      properties: {
        file_id: { type: "string", description: "Google file id (same as document/spreadsheet/presentation id)." },
        mime_type: {
          type: "string",
          description:
            "Export MIME type, e.g. application/pdf, text/csv, text/plain, application/vnd.openxmlformats-officedocument.wordprocessingml.document.",
        },
        output_path: { type: "string", description: "Optional local path to write exported bytes." },
      },
      required: ["file_id", "mime_type"],
      additionalProperties: false,
    },
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 30_000,
    handler: async (args): Promise<ToolResult> => {
      const fileId = String(args["file_id"] ?? "").trim();
      const mimeType = String(args["mime_type"] ?? "").trim();
      if (!fileId || !mimeType) return { ok: false, error: "file_id and mime_type are required" };
      const q = qs({ mimeType });
      const res = await googleOfficeApiBinary(
        DRIVE_BASE,
        "Drive API",
        `/files/${encodeURIComponent(fileId)}/export${q}`
      );
      if (!res.ok) return { ok: false, error: res.error };
      const outPath = String(args["output_path"] ?? "").trim();
      if (outPath) {
        await writeFile(outPath, res.data);
        return {
          ok: true,
          output: JSON.stringify(
            { file_id: fileId, mime_type: mimeType, output_path: outPath, bytes: res.data.length },
            null,
            2
          ),
        };
      }
      return {
        ok: true,
        output: JSON.stringify(
          {
            file_id: fileId,
            mime_type: mimeType,
            content_type: res.contentType,
            data_base64: res.data.toString("base64"),
            bytes: res.data.length,
          },
          null,
          2
        ),
      };
    },
  });
}

export function createGoogleOfficeRestTools(): ToolDefinition[] {
  return [
    ...createGoogleDocsRestTools(),
    ...createGoogleSheetsRestTools(),
    ...createGoogleSlidesRestTools(),
    createOfficeExportTool(),
  ];
}
