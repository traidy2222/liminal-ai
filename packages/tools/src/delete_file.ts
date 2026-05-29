import { rm, stat } from "node:fs/promises";
import { defineTool } from "./helpers.js";
import { resolveWithinWorkspace, existsAtPath } from "./file_path_guard.js";

export const deleteFileTool = defineTool({
  name: "delete_file",
  description:
    "WHAT: Delete a file (or a directory with recursive=true) inside the workspace.\n" +
    "WHEN: Removing a generated artifact, stale file, or scratch directory you created.\n" +
    "NOT WHEN: You only want to change contents — use edit_file/write_file. Never delete files you did not create or cannot recover.\n" +
    "ARGS: path — file/dir to delete; recursive — required to delete a non-empty directory (default false).",
  requiresApproval: true,
  dangerLevel: "destructive",
  resourceLocks: (args) => {
    const guard = resolveWithinWorkspace(String((args as Record<string, unknown>)["path"] ?? ""));
    return guard.ok && guard.resolvedPath ? [`file:write:${guard.resolvedPath}`] : [];
  },
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File or directory path to delete (workspace-relative)." },
      recursive: {
        type: "boolean",
        description: "Required to delete a directory (and its contents). Default false.",
      },
    },
    required: ["path"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const guard = resolveWithinWorkspace(String(args["path"] ?? ""));
    if (!guard.ok || !guard.resolvedPath) {
      return { ok: false, error: guard.error ?? "invalid path" };
    }
    const target = guard.resolvedPath;
    if (!(await existsAtPath(target))) {
      return { ok: false, error: `No such file or directory: ${target}` };
    }
    const recursive = Boolean(args["recursive"]);
    const info = await stat(target);
    if (info.isDirectory() && !recursive) {
      return {
        ok: false,
        error: `${target} is a directory — pass recursive: true to delete it and its contents.`,
      };
    }
    await rm(target, { recursive, force: false });
    return { ok: true, output: `Deleted ${info.isDirectory() ? "directory" : "file"}: ${target}` };
  },
});
