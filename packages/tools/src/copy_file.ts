import { cp, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { defineTool } from "./helpers.js";
import { resolveWithinWorkspace, existsAtPath } from "./file_path_guard.js";

export const copyFileTool = defineTool({
  name: "copy_file",
  description: "WHAT: Copy a file to a new location inside workspace.",
  requiresApproval: true,
  dangerLevel: "cautious",
  parameters: {
    type: "object",
    properties: {
      from: { type: "string", description: "Source file path." },
      to: { type: "string", description: "Destination file path." },
      overwrite: { type: "boolean", description: "Allow overwrite if destination exists." },
    },
    required: ["from", "to"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const src = resolveWithinWorkspace(String(args["from"] ?? ""));
    const dst = resolveWithinWorkspace(String(args["to"] ?? ""));
    if (!src.ok || !src.resolvedPath) return { ok: false, error: src.error ?? "invalid from path" };
    if (!dst.ok || !dst.resolvedPath) return { ok: false, error: dst.error ?? "invalid to path" };
    const overwrite = Boolean(args["overwrite"]);
    if (!overwrite && (await existsAtPath(dst.resolvedPath))) {
      return { ok: false, error: `Destination exists: ${dst.resolvedPath}` };
    }
    await mkdir(dirname(dst.resolvedPath), { recursive: true });
    await cp(src.resolvedPath, dst.resolvedPath, { force: overwrite });
    return { ok: true, output: `Copied ${src.resolvedPath} -> ${dst.resolvedPath}` };
  },
});

