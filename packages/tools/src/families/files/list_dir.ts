import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { defineTool } from "../../shared/helpers.js";
import { resolveWithinWorkspace } from "../../shared/file_path_guard.js";

export const listDirTool = defineTool({
  name: "list_dir",
  description:
    "WHAT: List files and subdirectories at a given path, annotating directories with a trailing /.\n" +
    "WHEN: Exploring an unknown directory, confirming a file exists before reading it, or discovering structure.\n" +
    "NOT WHEN: You already know the exact file path — call read_file directly.\n" +
    "ARGS: path — workspace-relative or absolute directory path (relative paths use the active chat workspace, not process CWD); show_hidden — include dot-files (default: false).",
  requiresApproval: false,
  cacheable: true,
  cacheTtlMs: 15_000,
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Workspace-relative or absolute directory path to list" },
      show_hidden: {
        type: "boolean",
        description: "Include hidden files (default: false)",
      },
    },
    required: ["path"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const safe = resolveWithinWorkspace(String(args["path"] ?? ""));
    if (!safe.ok || !safe.resolvedPath) return { ok: false, error: safe.error ?? "invalid directory path" };
    const dirPath = safe.resolvedPath;
    const showHidden = (args["show_hidden"] as boolean | undefined) ?? false;
    try {
      const entries = await readdir(dirPath);
      const filtered = showHidden ? entries : entries.filter((e) => !e.startsWith("."));

      const annotated = await Promise.all(
        filtered.map(async (name) => {
          try {
            const s = await stat(join(dirPath, name));
            return s.isDirectory() ? `${name}/` : name;
          } catch {
            return name;
          }
        })
      );

      return { ok: true, output: annotated.join("\n") || "(empty directory)" };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return { ok: false, error: `Directory does not exist: ${dirPath}` };
      if (code === "ENOTDIR") return { ok: false, error: `Path is not a directory: ${dirPath}` };
      return { ok: false, error: `Cannot list directory ${dirPath}: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
});
