import { stat, readFile } from "node:fs/promises";
import crypto from "node:crypto";
import { defineTool } from "./helpers.js";
import { resolveWithinWorkspace } from "./file_path_guard.js";

export const fileMetadataTool = defineTool({
  name: "file_metadata",
  description:
    "WHAT: Return metadata for a file (size, timestamps, line count, sha256 hash).\n" +
    "WHEN: You need verification, drift checks, or to decide chunking strategy.",
  requiresApproval: false,
  cacheable: true,
  cacheTtlMs: 10_000,
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path to inspect." },
      include_hash: { type: "boolean", description: "Include sha256 hash (default true)." },
    },
    required: ["path"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const safe = resolveWithinWorkspace(String(args["path"] ?? ""));
    if (!safe.ok || !safe.resolvedPath) return { ok: false, error: safe.error ?? "invalid path" };
    const includeHash = args["include_hash"] === undefined ? true : Boolean(args["include_hash"]);
    try {
      const s = await stat(safe.resolvedPath);
      const content = await readFile(safe.resolvedPath, "utf8");
      const out: Record<string, unknown> = {
        path: safe.resolvedPath,
        size_bytes: s.size,
        mtime: s.mtime.toISOString(),
        ctime: s.ctime.toISOString(),
        line_count: content.split(/\r?\n/).length,
      };
      if (includeHash) out["sha256"] = crypto.createHash("sha256").update(content).digest("hex");
      return { ok: true, output: JSON.stringify(out, null, 2) };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  },
});

