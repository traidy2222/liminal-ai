/**
 * Excel workbook session REST — read/write cell ranges via Microsoft Graph.
 */
import type { ToolDefinition, ToolResult } from "@liminal/core";
import { defineTool } from "../../shared/helpers.js";
import {
  graphApiJson,
  graphJsonResult,
  graphErrorResult,
  microsoftRestEnabled,
} from "./graph_rest.js";

export function excelRestEnabled(): boolean {
  return microsoftRestEnabled();
}

function workbookPath(itemId: string): string {
  return `/me/drive/items/${encodeURIComponent(itemId)}/workbook`;
}

export function createExcelRestTools(): ToolDefinition[] {
  const readRange = defineTool({
    name: "excel_rest_read_range",
    description: "Read values from an Excel worksheet range (requires drive item id).",
    parameters: {
      type: "object",
      properties: {
        item_id: { type: "string", description: "OneDrive Excel file item id." },
        worksheet: { type: "string", description: "Worksheet name (default Sheet1)." },
        address: { type: "string", description: "A1 notation e.g. A1:D10." },
      },
      required: ["item_id", "address"],
      additionalProperties: false,
    },
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 10_000,
    handler: async (args): Promise<ToolResult> => {
      if (!excelRestEnabled()) return graphErrorResult("Excel REST is off.");
      const itemId = String(args["item_id"] ?? "").trim();
      const sheet = encodeURIComponent(String(args["worksheet"] ?? "Sheet1"));
      const address = encodeURIComponent(String(args["address"] ?? ""));
      const path = `${workbookPath(itemId)}/worksheets('${sheet}')/range(address='${address}')`;
      const result = await graphApiJson(path);
      if (!result.ok) return graphErrorResult(result.error);
      return graphJsonResult(result.data);
    },
  });

  const updateRange = defineTool({
    name: "excel_rest_update_range",
    description: "Write values to an Excel worksheet range.",
    parameters: {
      type: "object",
      properties: {
        item_id: { type: "string" },
        worksheet: { type: "string" },
        address: { type: "string" },
        values: {
          type: "array",
          items: { type: "array", items: {} },
          description: "2D array of cell values.",
        },
      },
      required: ["item_id", "address", "values"],
      additionalProperties: false,
    },
    requiresApproval: true,
    handler: async (args): Promise<ToolResult> => {
      if (!excelRestEnabled()) return graphErrorResult("Excel REST is off.");
      const itemId = String(args["item_id"] ?? "").trim();
      const sheet = encodeURIComponent(String(args["worksheet"] ?? "Sheet1"));
      const address = encodeURIComponent(String(args["address"] ?? ""));
      const path = `${workbookPath(itemId)}/worksheets('${sheet}')/range(address='${address}')`;
      const result = await graphApiJson(path, {
        method: "PATCH",
        body: JSON.stringify({ values: args["values"] }),
      });
      if (!result.ok) return graphErrorResult(result.error);
      return graphJsonResult(result.data);
    },
  });

  return [readRange, updateRange];
}
