/**
 * Google Sheets REST — classic sheets.googleapis.com alongside mcp_google_ext_* (workspace-mcp).
 */
import type { ToolDefinition, ToolResult } from "@liminal/core";
import { defineTool } from "../../shared/helpers.js";
import {
  SHEETS_BASE,
  arraySchema,
  googleOfficeApiJson,
  qs,
} from "./google_office_rest_shared.js";
import { applySheetAutoFit, sheetsAutoFitEnabled } from "./google_sheets_layout.js";

function jsonResult(data: unknown): ToolResult {
  return { ok: true, output: JSON.stringify(data, null, 2) };
}

const autoFitParam = {
  type: "boolean" as const,
  description:
    "After writing values, auto-fit column widths (and narrow empty spacer columns). " +
    "Default follows AGENT_SHEETS_AUTO_FIT (on). Set false to skip.",
};

async function withOptionalAutoFit(
  args: Record<string, unknown>,
  spreadsheetId: string,
  range: string,
  values: unknown[][],
  result: ToolResult
): Promise<ToolResult> {
  if (!result.ok || !sheetsAutoFitEnabled(args)) return result;
  const fit = await applySheetAutoFit(spreadsheetId, range, values);
  if (!fit.ok) {
    const base = result.output ? `${result.output}\n` : "";
    return {
      ok: true,
      output: `${base}[auto_fit] skipped: ${fit.error}`,
    };
  }
  if (fit.requestsApplied === 0) return result;
  const base = result.output ? `${result.output}\n` : "";
  return {
    ok: true,
    output: `${base}[auto_fit] applied ${fit.requestsApplied} layout request(s) for ${range}`,
  };
}

function valueInputOption(args: Record<string, unknown>): string {
  const v = String(args["value_input_option"] ?? "USER_ENTERED").trim();
  return v === "RAW" ? "RAW" : "USER_ENTERED";
}

export function createGoogleSheetsRestTools(): ToolDefinition[] {
  const sheetsRestGetSpreadsheet = defineTool({
    name: "sheets_rest_get_spreadsheet",
    description:
      "WHAT: Get spreadsheet metadata (sheets, properties, named ranges) via spreadsheets.get.\n" +
      "WHEN: Need sheet ids/titles before values or batchUpdate; avoid include_grid_data unless necessary (large).",
    parameters: {
      type: "object",
      properties: {
        spreadsheet_id: { type: "string" },
        ranges: {
          type: "array",
          description: "A1 ranges to include (limits response size).",
          items: { type: "string" },
        },
        include_grid_data: { type: "boolean", description: "Include cell data (can be very large)." },
        fields: { type: "string", description: "Partial response mask (Fields parameter)." },
      },
      required: ["spreadsheet_id"],
      additionalProperties: false,
    },
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 15_000,
    handler: async (args): Promise<ToolResult> => {
      const id = String(args["spreadsheet_id"] ?? "").trim();
      if (!id) return { ok: false, error: "spreadsheet_id is required" };
      const ranges = Array.isArray(args["ranges"])
        ? (args["ranges"] as unknown[]).map((r) => String(r).trim()).filter(Boolean)
        : undefined;
      const q = qs({
        includeGridData: args["include_grid_data"] === true ? true : undefined,
        fields: String(args["fields"] ?? "").trim() || undefined,
      });
      let path = `/spreadsheets/${encodeURIComponent(id)}${q}`;
      if (ranges?.length) {
        const rangeQs = ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join("&");
        path += q ? `&${rangeQs}` : `?${rangeQs}`;
      }
      const res = await googleOfficeApiJson<unknown>(SHEETS_BASE, "Sheets API", path);
      if (!res.ok) return { ok: false, error: res.error };
      return jsonResult(res.data);
    },
  });

  const sheetsRestCreateSpreadsheet = defineTool({
    name: "sheets_rest_create_spreadsheet",
    description:
      "WHAT: Create a new spreadsheet (spreadsheets.create).\n" +
      "WHEN: User wants a new sheet before writing values or structural batchUpdate.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Spreadsheet title." },
        sheet_titles: {
          type: "array",
          description: "Initial sheet tab names (default one sheet).",
          items: { type: "string" },
        },
      },
      additionalProperties: false,
    },
    requiresApproval: true,
    dangerLevel: "destructive",
    handler: async (args): Promise<ToolResult> => {
      const title = String(args["title"] ?? "").trim();
      const sheetTitles = Array.isArray(args["sheet_titles"])
        ? (args["sheet_titles"] as unknown[]).map((t) => String(t).trim()).filter(Boolean)
        : [];
      const body: Record<string, unknown> = {};
      if (title) body.properties = { title };
      if (sheetTitles.length > 0) {
        body.sheets = sheetTitles.map((t) => ({ properties: { title: t } }));
      }
      const res = await googleOfficeApiJson<unknown>(SHEETS_BASE, "Sheets API", "/spreadsheets", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) return { ok: false, error: res.error };
      return jsonResult(res.data);
    },
  });

  const sheetsRestGetValues = defineTool({
    name: "sheets_rest_get_values",
    description:
      "WHAT: Read cell values for an A1 range (spreadsheets.values.get).\n" +
      "WHEN: Pull table data — simpler than MCP for raw grids.",
    parameters: {
      type: "object",
      properties: {
        spreadsheet_id: { type: "string" },
        range: { type: "string", description: "A1 notation, e.g. Sheet1!A1:D10." },
        value_render_option: { type: "string", enum: ["FORMATTED_VALUE", "UNFORMATTED_VALUE", "FORMULA"] },
        date_time_render_option: { type: "string", enum: ["SERIAL_NUMBER", "FORMATTED_STRING"] },
        major_dimension: { type: "string", enum: ["ROWS", "COLUMNS"] },
      },
      required: ["spreadsheet_id", "range"],
      additionalProperties: false,
    },
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 10_000,
    handler: async (args): Promise<ToolResult> => {
      const id = String(args["spreadsheet_id"] ?? "").trim();
      const range = String(args["range"] ?? "").trim();
      if (!id || !range) return { ok: false, error: "spreadsheet_id and range are required" };
      const q = qs({
        valueRenderOption: String(args["value_render_option"] ?? "").trim() || undefined,
        dateTimeRenderOption: String(args["date_time_render_option"] ?? "").trim() || undefined,
        majorDimension: String(args["major_dimension"] ?? "").trim() || undefined,
      });
      const res = await googleOfficeApiJson<unknown>(
        SHEETS_BASE,
        "Sheets API",
        `/spreadsheets/${encodeURIComponent(id)}/values/${encodeURIComponent(range)}${q}`
      );
      if (!res.ok) return { ok: false, error: res.error };
      return jsonResult(res.data);
    },
  });

  const sheetsRestUpdateValues = defineTool({
    name: "sheets_rest_update_values",
    description:
      "WHAT: Overwrite a range with a 2D values array (spreadsheets.values.update).\n" +
      "WHEN: Set or replace table cells — use USER_ENTERED for formulas/dates as typed.",
    parameters: {
      type: "object",
      properties: {
        spreadsheet_id: { type: "string" },
        range: { type: "string", description: "A1 notation target range." },
        values: arraySchema("2D array of cell values (rows of columns).", { type: "array", items: {} } as never),
        value_input_option: { type: "string", enum: ["RAW", "USER_ENTERED"], description: "Default USER_ENTERED." },
        include_values_in_response: { type: "boolean" },
        auto_fit: autoFitParam,
      },
      required: ["spreadsheet_id", "range", "values"],
      additionalProperties: false,
    },
    requiresApproval: true,
    dangerLevel: "destructive",
    handler: async (args): Promise<ToolResult> => {
      const id = String(args["spreadsheet_id"] ?? "").trim();
      const range = String(args["range"] ?? "").trim();
      if (!id || !range) return { ok: false, error: "spreadsheet_id and range are required" };
      if (!Array.isArray(args["values"])) return { ok: false, error: "values must be a 2D array" };
      const q = qs({
        valueInputOption: valueInputOption(args),
        includeValuesInResponse: args["include_values_in_response"] === true ? true : undefined,
      });
      const res = await googleOfficeApiJson<unknown>(
        SHEETS_BASE,
        "Sheets API",
        `/spreadsheets/${encodeURIComponent(id)}/values/${encodeURIComponent(range)}${q}`,
        { method: "PUT", body: JSON.stringify({ values: args["values"] }) }
      );
      if (!res.ok) return { ok: false, error: res.error };
      const values = args["values"] as unknown[][];
      return withOptionalAutoFit(args, id, range, values, jsonResult(res.data));
    },
  });

  const sheetsRestAppendValues = defineTool({
    name: "sheets_rest_append_values",
    description:
      "WHAT: Append rows to a sheet (spreadsheets.values.append).\n" +
      "WHEN: Add log rows or new records after existing data.",
    parameters: {
      type: "object",
      properties: {
        spreadsheet_id: { type: "string" },
        range: { type: "string", description: "A1 anchor range, e.g. Sheet1!A1." },
        values: arraySchema("2D array of rows to append."),
        value_input_option: { type: "string", enum: ["RAW", "USER_ENTERED"] },
        insert_data_option: { type: "string", enum: ["OVERWRITE", "INSERT_ROWS"] },
        auto_fit: autoFitParam,
      },
      required: ["spreadsheet_id", "range", "values"],
      additionalProperties: false,
    },
    requiresApproval: true,
    dangerLevel: "destructive",
    handler: async (args): Promise<ToolResult> => {
      const id = String(args["spreadsheet_id"] ?? "").trim();
      const range = String(args["range"] ?? "").trim();
      if (!id || !range) return { ok: false, error: "spreadsheet_id and range are required" };
      if (!Array.isArray(args["values"])) return { ok: false, error: "values must be a 2D array" };
      const insertOpt = String(args["insert_data_option"] ?? "").trim();
      const q = qs({
        valueInputOption: valueInputOption(args),
        insertDataOption: insertOpt === "OVERWRITE" || insertOpt === "INSERT_ROWS" ? insertOpt : undefined,
      });
      const res = await googleOfficeApiJson<unknown>(
        SHEETS_BASE,
        "Sheets API",
        `/spreadsheets/${encodeURIComponent(id)}/values/${encodeURIComponent(range)}:append${q}`,
        { method: "POST", body: JSON.stringify({ values: args["values"] }) }
      );
      if (!res.ok) return { ok: false, error: res.error };
      const values = args["values"] as unknown[][];
      const updatedRange =
        res.data &&
        typeof res.data === "object" &&
        "updates" in res.data &&
        res.data.updates &&
        typeof res.data.updates === "object" &&
        "updatedRange" in res.data.updates
          ? String((res.data.updates as { updatedRange?: string }).updatedRange ?? "").trim()
          : "";
      const fitRange = updatedRange || range;
      return withOptionalAutoFit(args, id, fitRange, values, jsonResult(res.data));
    },
  });

  const sheetsRestBatchGetValues = defineTool({
    name: "sheets_rest_batch_get_values",
    description:
      "WHAT: Read multiple ranges in one call (spreadsheets.values.batchGet).\n" +
      "WHEN: Pull several tables from one spreadsheet efficiently.",
    parameters: {
      type: "object",
      properties: {
        spreadsheet_id: { type: "string" },
        ranges: {
          type: "array",
          items: { type: "string" },
          description: "A1 ranges to fetch.",
        },
        value_render_option: { type: "string", enum: ["FORMATTED_VALUE", "UNFORMATTED_VALUE", "FORMULA"] },
        major_dimension: { type: "string", enum: ["ROWS", "COLUMNS"] },
      },
      required: ["spreadsheet_id", "ranges"],
      additionalProperties: false,
    },
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 10_000,
    handler: async (args): Promise<ToolResult> => {
      const id = String(args["spreadsheet_id"] ?? "").trim();
      if (!id) return { ok: false, error: "spreadsheet_id is required" };
      const ranges = Array.isArray(args["ranges"])
        ? (args["ranges"] as unknown[]).map((r) => String(r).trim()).filter(Boolean)
        : [];
      if (ranges.length === 0) return { ok: false, error: "ranges array is required" };
      const rangeQs = ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join("&");
      const q = qs({
        valueRenderOption: String(args["value_render_option"] ?? "").trim() || undefined,
        majorDimension: String(args["major_dimension"] ?? "").trim() || undefined,
      });
      const suffix = q ? `${q}&${rangeQs}` : `?${rangeQs}`;
      const res = await googleOfficeApiJson<unknown>(
        SHEETS_BASE,
        "Sheets API",
        `/spreadsheets/${encodeURIComponent(id)}/values:batchGet${suffix}`
      );
      if (!res.ok) return { ok: false, error: res.error };
      return jsonResult(res.data);
    },
  });

  const sheetsRestBatchUpdateValues = defineTool({
    name: "sheets_rest_batch_update_values",
    description:
      "WHAT: Update multiple ranges atomically (spreadsheets.values.batchUpdate).\n" +
      "WHEN: Write several disconnected cell blocks in one request.",
    parameters: {
      type: "object",
      properties: {
        spreadsheet_id: { type: "string" },
        data: arraySchema("ValueRange objects: { range, values } per Sheets API."),
        value_input_option: { type: "string", enum: ["RAW", "USER_ENTERED"] },
        include_values_in_response: { type: "boolean" },
        auto_fit: autoFitParam,
      },
      required: ["spreadsheet_id", "data"],
      additionalProperties: false,
    },
    requiresApproval: true,
    dangerLevel: "destructive",
    handler: async (args): Promise<ToolResult> => {
      const id = String(args["spreadsheet_id"] ?? "").trim();
      if (!id) return { ok: false, error: "spreadsheet_id is required" };
      if (!Array.isArray(args["data"]) || args["data"].length === 0) {
        return { ok: false, error: "data array is required" };
      }
      const body: Record<string, unknown> = {
        data: args["data"],
        valueInputOption: valueInputOption(args),
      };
      if (args["include_values_in_response"] === true) body.includeValuesInResponse = true;
      const res = await googleOfficeApiJson<unknown>(
        SHEETS_BASE,
        "Sheets API",
        `/spreadsheets/${encodeURIComponent(id)}/values:batchUpdate`,
        { method: "POST", body: JSON.stringify(body) }
      );
      if (!res.ok) return { ok: false, error: res.error };
      let out = jsonResult(res.data);
      if (sheetsAutoFitEnabled(args) && Array.isArray(args["data"])) {
        for (const block of args["data"] as Record<string, unknown>[]) {
          const blockRange = String(block["range"] ?? "").trim();
          const blockValues = block["values"];
          if (!blockRange || !Array.isArray(blockValues)) continue;
          out = await withOptionalAutoFit(
            args,
            id,
            blockRange,
            blockValues as unknown[][],
            out
          );
        }
      }
      return out;
    },
  });

  const sheetsRestClearValues = defineTool({
    name: "sheets_rest_clear_values",
    description:
      "WHAT: Clear values in a range (spreadsheets.values.clear).\n" +
      "WHEN: Empty cells without deleting the sheet.",
    parameters: {
      type: "object",
      properties: {
        spreadsheet_id: { type: "string" },
        range: { type: "string", description: "A1 range to clear." },
      },
      required: ["spreadsheet_id", "range"],
      additionalProperties: false,
    },
    requiresApproval: true,
    dangerLevel: "destructive",
    handler: async (args): Promise<ToolResult> => {
      const id = String(args["spreadsheet_id"] ?? "").trim();
      const range = String(args["range"] ?? "").trim();
      if (!id || !range) return { ok: false, error: "spreadsheet_id and range are required" };
      const res = await googleOfficeApiJson<unknown>(
        SHEETS_BASE,
        "Sheets API",
        `/spreadsheets/${encodeURIComponent(id)}/values/${encodeURIComponent(range)}:clear`,
        { method: "POST", body: JSON.stringify({}) }
      );
      if (!res.ok) return { ok: false, error: res.error };
      return jsonResult(res.data);
    },
  });

  const sheetsRestAutoFit = defineTool({
    name: "sheets_rest_auto_fit",
    description:
      "WHAT: Auto-fit column widths for an A1 range (Sheets autoResizeDimensions + spacer columns).\n" +
      "WHEN: After manual edits or batch_update formatting — or when auto_fit on a write was skipped.",
    parameters: {
      type: "object",
      properties: {
        spreadsheet_id: { type: "string" },
        range: { type: "string", description: "A1 range to fit, e.g. Sheet1!A1:H50." },
      },
      required: ["spreadsheet_id", "range"],
      additionalProperties: false,
    },
    requiresApproval: true,
    dangerLevel: "destructive",
    handler: async (args): Promise<ToolResult> => {
      const id = String(args["spreadsheet_id"] ?? "").trim();
      const range = String(args["range"] ?? "").trim();
      if (!id || !range) return { ok: false, error: "spreadsheet_id and range are required" };
      const fit = await applySheetAutoFit(id, range);
      if (!fit.ok) return { ok: false, error: fit.error };
      return jsonResult({ range, requestsApplied: fit.requestsApplied });
    },
  });

  const sheetsRestBatchUpdate = defineTool({
    name: "sheets_rest_batch_update",
    description:
      "WHAT: Structural/format updates (addSheet, deleteSheet, mergeCells, repeatCell, charts, filters, …).\n" +
      "WHEN: Change layout/format beyond raw values — pass `requests` per Sheets batchUpdate API.",
    parameters: {
      type: "object",
      properties: {
        spreadsheet_id: { type: "string" },
        requests: arraySchema("Sheets API Request objects (addSheet, updateCells, duplicateSheet, …)."),
        include_spreadsheet_in_response: { type: "boolean" },
        response_ranges: {
          type: "array",
          items: { type: "string" },
          description: "Ranges to include in response when include_spreadsheet_in_response is true.",
        },
      },
      required: ["spreadsheet_id", "requests"],
      additionalProperties: false,
    },
    requiresApproval: true,
    dangerLevel: "destructive",
    handler: async (args): Promise<ToolResult> => {
      const id = String(args["spreadsheet_id"] ?? "").trim();
      if (!id) return { ok: false, error: "spreadsheet_id is required" };
      if (!Array.isArray(args["requests"]) || args["requests"].length === 0) {
        return { ok: false, error: "requests array is required" };
      }
      const body: Record<string, unknown> = { requests: args["requests"] };
      if (args["include_spreadsheet_in_response"] === true) {
        body.includeSpreadsheetInResponse = true;
        if (Array.isArray(args["response_ranges"])) {
          body.responseRanges = args["response_ranges"];
        }
      }
      const res = await googleOfficeApiJson<unknown>(
        SHEETS_BASE,
        "Sheets API",
        `/spreadsheets/${encodeURIComponent(id)}:batchUpdate`,
        { method: "POST", body: JSON.stringify(body) }
      );
      if (!res.ok) return { ok: false, error: res.error };
      return jsonResult(res.data);
    },
  });

  return [
    sheetsRestGetSpreadsheet,
    sheetsRestCreateSpreadsheet,
    sheetsRestGetValues,
    sheetsRestUpdateValues,
    sheetsRestAppendValues,
    sheetsRestBatchGetValues,
    sheetsRestBatchUpdateValues,
    sheetsRestClearValues,
    sheetsRestAutoFit,
    sheetsRestBatchUpdate,
  ];
}
