/**
 * Xero Phase 3 — Files API (org-wide file cabinet).
 */
import { writeFile, mkdir } from "node:fs/promises";
import { basename, dirname } from "node:path";
import type { PropertySchema, ToolRegistry, ToolResult } from "@liminal/core";
import { defineTool } from "../../shared/helpers.js";
import {
  readWorkspaceFileBytes,
  resolveWithinWorkspace,
} from "../../shared/file_path_guard.js";
import {
  asToolResult,
  jsonOutput,
  xeroCommonProps,
  xeroFetch,
  xeroFetchBinary,
  xeroHint,
  xeroTenant,
} from "./xero_api.js";
import { XERO_FILES_API } from "./xero_api_bases.js";

const COMMON = xeroCommonProps();
const FILES_OPTS = { apiBase: XERO_FILES_API as typeof XERO_FILES_API };

function idArg(name: string, label: string): Record<string, PropertySchema> {
  return { [name]: { type: "string", description: label } };
}

export function registerXeroFilesTools(registry: ToolRegistry): void {
  registry.register(
    defineTool({
      name: "xero_files_list",
      description:
        "WHAT: List files in the Xero Files cabinet (not invoice attachments).\n" +
        "WHEN: Org-wide document storage — requires files.read scope.",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          page: { type: "number" },
          page_size: { type: "number", description: "1–100, default 50." },
          sort: { type: "string", enum: ["Name", "Size", "CreatedDateUTC"] },
          direction: { type: "string", enum: ["ASC", "DESC"] },
        },
        additionalProperties: false,
      },
      requiresApproval: false,
      handler: async (args): Promise<ToolResult> => {
        const params = new URLSearchParams();
        if (typeof args["page"] === "number" && args["page"] > 0) {
          params.set("page", String(Math.floor(args["page"])));
        }
        if (typeof args["page_size"] === "number" && args["page_size"] > 0) {
          params.set("pagesize", String(Math.min(100, Math.floor(args["page_size"]))));
        }
        if (typeof args["sort"] === "string") params.set("sort", args["sort"]);
        if (typeof args["direction"] === "string") params.set("direction", args["direction"]);
        const q = params.toString();
        return asToolResult(
          await xeroFetch(q ? `/Files?${q}` : "/Files", {
            ...FILES_OPTS,
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_files_get",
      description: "WHAT: Fetch file metadata by FileId GUID.",
      parameters: {
        type: "object",
        properties: { ...COMMON, ...idArg("file_id", "FileId GUID.") },
        required: ["file_id"],
        additionalProperties: false,
      },
      requiresApproval: false,
      handler: async (args): Promise<ToolResult> => {
        const id = String(args["file_id"] ?? "").trim();
        if (!id) return { ok: false, error: "file_id required" };
        return asToolResult(
          await xeroFetch(`/Files/${encodeURIComponent(id)}`, {
            ...FILES_OPTS,
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_files_download",
      description: "WHAT: Download file bytes from the Files cabinet.\nWHEN: Save to workspace or return base64.",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          ...idArg("file_id", "FileId GUID."),
          save_path: { type: "string", description: "Workspace-relative path to write." },
          content_base64: {
            type: "boolean",
            description: "If true, return base64 in output instead of save_path.",
          },
        },
        required: ["file_id"],
        additionalProperties: false,
      },
      requiresApproval: false,
      handler: async (args): Promise<ToolResult> => {
        const id = String(args["file_id"] ?? "").trim();
        if (!id) return { ok: false, error: "file_id required" };
        const r = await xeroFetchBinary(`/Files/${encodeURIComponent(id)}/Content`, {
          ...FILES_OPTS,
          accountHint: xeroHint(args),
          tenantId: xeroTenant(args),
        });
        if (!r.ok) return r;
        if (args["content_base64"] === true) {
          return {
            ok: true,
            output: jsonOutput({
              file_id: id,
              content_type: r.contentType,
              size_bytes: r.data.length,
              content_base64: r.data.toString("base64"),
            }),
          };
        }
        const savePath = typeof args["save_path"] === "string" ? args["save_path"].trim() : "";
        if (!savePath) return { ok: false, error: "provide save_path or content_base64: true" };
        const safe = resolveWithinWorkspace(savePath);
        if (!safe.ok || !safe.resolvedPath) {
          return { ok: false, error: safe.error ?? "save_path must stay inside workspace" };
        }
        await mkdir(dirname(safe.resolvedPath), { recursive: true });
        await writeFile(safe.resolvedPath, r.data);
        return {
          ok: true,
          output: jsonOutput({
            file_id: id,
            save_path: savePath,
            size_bytes: r.data.length,
            content_type: r.contentType,
          }),
        };
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_files_upload",
      description: "WHAT: Upload a file to the Xero Files inbox.\nWHEN: Store org documents outside invoice attachments.",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          file_path: { type: "string", description: "Workspace-relative file to upload." },
          content_base64: { type: "string", description: "Alternative to file_path." },
          file_name: { type: "string" },
          folder_id: { type: "string", description: "Optional FolderId GUID." },
          mime_type: { type: "string" },
        },
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const b64 = typeof args["content_base64"] === "string" ? args["content_base64"].trim() : "";
        const filePath = typeof args["file_path"] === "string" ? args["file_path"].trim() : "";
        let bytes: Buffer;
        let name = typeof args["file_name"] === "string" ? args["file_name"].trim() : "";
        if (b64) {
          try {
            bytes = Buffer.from(b64, "base64");
          } catch {
            return { ok: false, error: "invalid content_base64" };
          }
          if (!name) name = "upload.bin";
        } else if (filePath) {
          const file = await readWorkspaceFileBytes(filePath);
          if (!file.ok) return { ok: false, error: file.error };
          bytes = file.bytes;
          if (!name) name = basename(file.resolvedPath);
        } else {
          return { ok: false, error: "provide file_path or content_base64" };
        }
        const form = new FormData();
        const mime = typeof args["mime_type"] === "string" ? args["mime_type"] : "application/octet-stream";
        form.append("file", new Blob([new Uint8Array(bytes)], { type: mime }), name);
        if (typeof args["folder_id"] === "string" && args["folder_id"].trim()) {
          form.append("FolderId", args["folder_id"].trim());
        }
        return asToolResult(
          await xeroFetch("/Files", {
            method: "POST",
            bodyForm: form,
            ...FILES_OPTS,
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_files_delete",
      description: "WHAT: Delete a file from the Files cabinet.",
      parameters: {
        type: "object",
        properties: { ...COMMON, ...idArg("file_id", "FileId GUID.") },
        required: ["file_id"],
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const id = String(args["file_id"] ?? "").trim();
        if (!id) return { ok: false, error: "file_id required" };
        return asToolResult(
          await xeroFetch(`/Files/${encodeURIComponent(id)}`, {
            method: "DELETE",
            ...FILES_OPTS,
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_files_list_folders",
      description: "WHAT: List folders in the Xero Files cabinet.",
      parameters: { type: "object", properties: { ...COMMON }, additionalProperties: false },
      requiresApproval: false,
      handler: async (args): Promise<ToolResult> =>
        asToolResult(
          await xeroFetch("/Folders", {
            ...FILES_OPTS,
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        ),
    })
  );

  registry.register(
    defineTool({
      name: "xero_files_get_folder",
      description: "WHAT: Fetch one folder by FolderId.",
      parameters: {
        type: "object",
        properties: { ...COMMON, ...idArg("folder_id", "FolderId GUID.") },
        required: ["folder_id"],
        additionalProperties: false,
      },
      requiresApproval: false,
      handler: async (args): Promise<ToolResult> => {
        const id = String(args["folder_id"] ?? "").trim();
        if (!id) return { ok: false, error: "folder_id required" };
        return asToolResult(
          await xeroFetch(`/Folders/${encodeURIComponent(id)}`, {
            ...FILES_OPTS,
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_files_list_associations",
      description: "WHAT: List Xero objects linked to a file (invoice, contact, etc.).",
      parameters: {
        type: "object",
        properties: { ...COMMON, ...idArg("file_id", "FileId GUID.") },
        required: ["file_id"],
        additionalProperties: false,
      },
      requiresApproval: false,
      handler: async (args): Promise<ToolResult> => {
        const id = String(args["file_id"] ?? "").trim();
        if (!id) return { ok: false, error: "file_id required" };
        return asToolResult(
          await xeroFetch(`/Files/${encodeURIComponent(id)}/Associations`, {
            ...FILES_OPTS,
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );
}
