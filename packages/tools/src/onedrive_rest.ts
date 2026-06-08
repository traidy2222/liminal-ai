/**
 * OneDrive / SharePoint file REST helpers.
 */
import { readFile } from "node:fs/promises";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { PropertySchema, ToolDefinition, ToolResult } from "@liminal/core";
import { defineTool } from "./helpers.js";
import {
  graphApiFetch,
  graphApiJson,
  graphJsonResult,
  graphErrorResult,
  microsoftRestEnabled,
} from "./graph_rest.js";

export function onedriveRestEnabled(): boolean {
  return microsoftRestEnabled();
}

function driveItemPath(args: Record<string, unknown>): string {
  const itemId = String(args["item_id"] ?? "").trim();
  const path = String(args["path"] ?? "").trim();
  if (itemId) return `/me/drive/items/${encodeURIComponent(itemId)}`;
  if (path) {
    const normalized = path.replace(/^\/+/, "");
    return `/me/drive/root:/${normalized.split("/").map(encodeURIComponent).join("/")}`;
  }
  return "/me/drive/root";
}

export function createOnedriveRestTools(): ToolDefinition[] {
  const listChildren = defineTool({
    name: "onedrive_rest_list_children",
    description: "List files/folders in a OneDrive folder.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Folder path from root e.g. Documents/Reports" },
        item_id: { type: "string", description: "Or drive item id." },
        top: { type: "number" },
      },
      additionalProperties: false,
    },
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 10_000,
    handler: async (args): Promise<ToolResult> => {
      if (!onedriveRestEnabled()) return graphErrorResult("OneDrive REST is off.");
      const itemId = String(args["item_id"] ?? "").trim();
      const folderPath = String(args["path"] ?? "").trim();
      const top = args["top"] != null ? `?$top=${Number(args["top"])}` : "";
      let apiPath: string;
      if (itemId) {
        apiPath = `/me/drive/items/${encodeURIComponent(itemId)}/children${top}`;
      } else if (folderPath) {
        const normalized = folderPath.replace(/^\/+/, "");
        apiPath = `/me/drive/root:/${normalized.split("/").map(encodeURIComponent).join("/")}:/children${top}`;
      } else {
        apiPath = `/me/drive/root/children${top}`;
      }
      const result = await graphApiJson(apiPath);
      if (!result.ok) return graphErrorResult(result.error);
      return graphJsonResult(result.data);
    },
  });

  const uploadFile = defineTool({
    name: "onedrive_rest_upload_file",
    description: "Upload a local file to OneDrive (simple upload, <4MB).",
    parameters: {
      type: "object",
      properties: {
        local_path: { type: "string" },
        dest_path: { type: "string", description: "OneDrive path including filename." },
        conflict_behavior: { type: "string", enum: ["replace", "rename", "fail"] },
      },
      required: ["local_path", "dest_path"],
      additionalProperties: false,
    },
    requiresApproval: true,
    handler: async (args): Promise<ToolResult> => {
      if (!onedriveRestEnabled()) return graphErrorResult("OneDrive REST is off.");
      const localPath = String(args["local_path"] ?? "").trim();
      const dest = String(args["dest_path"] ?? "").trim().replace(/^\/+/, "");
      const buf = await readFile(localPath);
      const conflict = String(args["conflict_behavior"] ?? "replace");
      const urlPath = `/me/drive/root:/${dest.split("/").map(encodeURIComponent).join("/")}:/content?@microsoft.graph.conflictBehavior=${conflict}`;
      try {
        const res = await graphApiFetch(urlPath, {
          method: "PUT",
          headers: { "Content-Type": "application/octet-stream" },
          body: buf,
        });
        const text = await res.text();
        if (!res.ok) return graphErrorResult(`Upload failed HTTP ${res.status}: ${text.slice(0, 300)}`);
        const data = text.trim() ? JSON.parse(text) : {};
        return graphJsonResult(data);
      } catch (e) {
        return graphErrorResult(e instanceof Error ? e.message : String(e));
      }
    },
  });

  const downloadFile = defineTool({
    name: "onedrive_rest_download_file",
    description: "Download a OneDrive file to a local path.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        item_id: { type: "string" },
        local_path: { type: "string" },
      },
      required: ["local_path"],
      additionalProperties: false,
    },
    requiresApproval: false,
    handler: async (args): Promise<ToolResult> => {
      if (!onedriveRestEnabled()) return graphErrorResult("OneDrive REST is off.");
      const localPath = String(args["local_path"] ?? "").trim();
      const base = driveItemPath(args);
      const urlPath = `${base}/content`;
      try {
        const res = await graphApiFetch(urlPath);
        if (!res.ok) {
          const t = await res.text();
          return graphErrorResult(`Download failed HTTP ${res.status}: ${t.slice(0, 300)}`);
        }
        const buf = Buffer.from(await res.arrayBuffer());
        await mkdir(dirname(localPath), { recursive: true });
        await writeFile(localPath, buf);
        return { ok: true, output: `Downloaded ${buf.length} bytes to ${localPath}` };
      } catch (e) {
        return graphErrorResult(e instanceof Error ? e.message : String(e));
      }
    },
  });

  const shareLink = defineTool({
    name: "onedrive_rest_create_share_link",
    description: "Create a sharing link for a OneDrive item.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        item_id: { type: "string" },
        type: { type: "string", enum: ["view", "edit"], description: "Link permission." },
        scope: { type: "string", enum: ["anonymous", "organization"] },
      },
      additionalProperties: false,
    },
    requiresApproval: true,
    handler: async (args): Promise<ToolResult> => {
      if (!onedriveRestEnabled()) return graphErrorResult("OneDrive REST is off.");
      const base = driveItemPath(args);
      const linkType = args["type"] === "edit" ? "edit" : "view";
      const scope = args["scope"] === "anonymous" ? "anonymous" : "organization";
      const result = await graphApiJson(`${base}/createLink`, {
        method: "POST",
        body: JSON.stringify({ type: linkType, scope }),
      });
      if (!result.ok) return graphErrorResult(result.error);
      return graphJsonResult(result.data);
    },
  });

  return [listChildren, uploadFile, downloadFile, shareLink];
}
