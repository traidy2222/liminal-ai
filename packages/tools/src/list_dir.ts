import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { defineTool } from "./helpers.js";

export const listDirTool = defineTool({
  name: "list_dir",
  description:
    "WHAT: List files and subdirectories at a given path, annotating directories with a trailing /.\n" +
    "WHEN: Exploring an unknown directory, confirming a file exists before reading it, or discovering structure.\n" +
    "NOT WHEN: You already know the exact file path — call read_file directly.\n" +
    "ARGS: path — directory to list; show_hidden — include dot-files (default: false).",
  requiresApproval: false,
  cacheable: true,
  cacheTtlMs: 15_000,
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Directory path to list" },
      show_hidden: {
        type: "boolean",
        description: "Include hidden files (default: false)",
      },
    },
    required: ["path"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const dirPath = args["path"] as string;
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
      return { ok: false, error: String(err) };
    }
  },
});
