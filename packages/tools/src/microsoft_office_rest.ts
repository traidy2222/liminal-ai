/**
 * Word/PowerPoint file lifecycle + SharePoint helpers via Graph.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { ToolDefinition, ToolResult } from "@liminal/core";
import { defineTool } from "./helpers.js";
import {
  graphApiFetch,
  graphApiJson,
  graphJsonResult,
  graphErrorResult,
  microsoftRestEnabled,
} from "./graph_rest.js";

export function microsoftOfficeRestEnabled(): boolean {
  return microsoftRestEnabled();
}

export function createMicrosoftOfficeRestTools(): ToolDefinition[] {
  const exportPdf = defineTool({
    name: "office_rest_export_pdf",
    description:
      "Export a Word/PowerPoint/Excel file from OneDrive to PDF locally. Graph does not edit Word body in-place.",
    parameters: {
      type: "object",
      properties: {
        item_id: { type: "string" },
        path: { type: "string", description: "OneDrive path to file." },
        local_path: { type: "string", description: "Local output .pdf path." },
      },
      required: ["local_path"],
      additionalProperties: false,
    },
    requiresApproval: false,
    handler: async (args): Promise<ToolResult> => {
      if (!microsoftOfficeRestEnabled()) return graphErrorResult("Microsoft Office REST is off.");
      const itemId = String(args["item_id"] ?? "").trim();
      const filePath = String(args["path"] ?? "").trim();
      const localPath = String(args["local_path"] ?? "").trim();
      let contentUrl: string;
      if (itemId) {
        contentUrl = `/me/drive/items/${encodeURIComponent(itemId)}/content?format=pdf`;
      } else if (filePath) {
        const normalized = filePath.replace(/^\/+/, "");
        contentUrl = `/me/drive/root:/${normalized.split("/").map(encodeURIComponent).join("/")}:/content?format=pdf`;
      } else {
        return graphErrorResult("item_id or path is required.");
      }
      try {
        const res = await graphApiFetch(contentUrl);
        if (!res.ok) {
          const t = await res.text();
          return graphErrorResult(`Export failed HTTP ${res.status}: ${t.slice(0, 300)}`);
        }
        const buf = Buffer.from(await res.arrayBuffer());
        await mkdir(dirname(localPath), { recursive: true });
        await writeFile(localPath, buf);
        return { ok: true, output: `Exported PDF (${buf.length} bytes) to ${localPath}` };
      } catch (e) {
        return graphErrorResult(e instanceof Error ? e.message : String(e));
      }
    },
  });

  const uploadOfficeFile = defineTool({
    name: "office_rest_upload_file",
    description: "Upload a local .docx/.pptx/.xlsx to OneDrive.",
    parameters: {
      type: "object",
      properties: {
        local_path: { type: "string" },
        dest_path: { type: "string" },
      },
      required: ["local_path", "dest_path"],
      additionalProperties: false,
    },
    requiresApproval: true,
    handler: async (args): Promise<ToolResult> => {
      if (!microsoftOfficeRestEnabled()) return graphErrorResult("Microsoft Office REST is off.");
      const localPath = String(args["local_path"] ?? "").trim();
      const dest = String(args["dest_path"] ?? "").trim().replace(/^\/+/, "");
      const buf = await readFile(localPath);
      const urlPath = `/me/drive/root:/${dest.split("/").map(encodeURIComponent).join("/")}:/content`;
      const res = await graphApiFetch(urlPath, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: buf,
      });
      const text = await res.text();
      if (!res.ok) return graphErrorResult(`Upload failed HTTP ${res.status}: ${text.slice(0, 300)}`);
      const data = text.trim() ? JSON.parse(text) : {};
      return graphJsonResult(data);
    },
  });

  const listSharePointSites = defineTool({
    name: "sharepoint_rest_list_followed_sites",
    description: "List SharePoint sites the user follows.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 60_000,
    handler: async (): Promise<ToolResult> => {
      if (!microsoftOfficeRestEnabled()) return graphErrorResult("SharePoint REST is off.");
      const result = await graphApiJson("/me/followedSites");
      if (!result.ok) return graphErrorResult(result.error);
      return graphJsonResult(result.data);
    },
  });

  return [exportPdf, uploadOfficeFile, listSharePointSites];
}
