import { cp } from "node:fs/promises";
import { defineTool } from "../../shared/helpers.js";
import { resolveWithinWorkspace, existsAtPath } from "../../shared/file_path_guard.js";

export const copyTreeTool = defineTool({
  name: "copy_tree",
  description: "WHAT: Copy an entire directory tree within workspace.",
  requiresApproval: true,
  dangerLevel: "cautious",
  parameters: {
    type: "object",
    properties: {
      from: { type: "string", description: "Source directory path." },
      to: { type: "string", description: "Destination directory path." },
      overwrite: { type: "boolean", description: "Allow overwrite." },
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
    await cp(src.resolvedPath, dst.resolvedPath, { recursive: true, force: overwrite });
    return { ok: true, output: `Copied tree ${src.resolvedPath} -> ${dst.resolvedPath}` };
  },
});

