import { readFile } from "node:fs/promises";
import { defineTool } from "./helpers.js";

export const readFileTool = defineTool({
  name: "read_file",
  description:
    "WHAT: Read the full text contents of a file from disk.\n" +
    "WHEN: You know the exact path and need to inspect or process the file's content.\n" +
    "NOT WHEN: File existence is uncertain — use list_dir first to confirm the path.\n" +
    "ARGS: path — absolute or relative file path; encoding — optional (default: utf8).",
  requiresApproval: false,
  cacheable: true,
  cacheTtlMs: 30_000,
  resourceLocks: (args) => [`file:read:${args["path"] as string}`],
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute or relative file path" },
      encoding: { type: "string", description: "File encoding (default: utf8)" },
    },
    required: ["path"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const path = args["path"] as string;
    const encoding = (args["encoding"] as BufferEncoding | undefined) ?? "utf8";
    try {
      const content = await readFile(path, { encoding });
      return { ok: true, output: content };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  },
});
