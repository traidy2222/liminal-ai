import { readFile } from "node:fs/promises";
import { defineTool } from "./helpers.js";
import { resolveWithinWorkspace } from "./file_path_guard.js";

export const readFileChunkedTool = defineTool({
  name: "read_file_chunked",
  description:
    "WHAT: Read a file in deterministic chunks by line range.\n" +
    "WHEN: File is too large for one read or you need progressive context.",
  requiresApproval: false,
  cacheable: true,
  cacheTtlMs: 15_000,
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path." },
      chunk_index: { type: "number", description: "0-based chunk index." },
      chunk_lines: { type: "number", description: "Lines per chunk (default 200)." },
    },
    required: ["path"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const safe = resolveWithinWorkspace(String(args["path"] ?? ""));
    if (!safe.ok || !safe.resolvedPath) return { ok: false, error: safe.error ?? "invalid path" };
    const chunkIndex = Math.max(0, Number(args["chunk_index"] ?? 0) || 0);
    const chunkLines = Math.max(20, Math.min(1000, Number(args["chunk_lines"] ?? 200) || 200));
    try {
      const content = await readFile(safe.resolvedPath, "utf8");
      const lines = content.split(/\r?\n/);
      const total = lines.length;
      const start = chunkIndex * chunkLines;
      const end = Math.min(total, start + chunkLines);
      if (start >= total) {
        return {
          ok: true,
          output: JSON.stringify({ path: safe.resolvedPath, chunk_index: chunkIndex, total_lines: total, done: true }, null, 2),
        };
      }
      const body = lines.slice(start, end).join("\n");
      return {
        ok: true,
        output:
          JSON.stringify(
            {
              path: safe.resolvedPath,
              chunk_index: chunkIndex,
              chunk_lines: chunkLines,
              line_start: start + 1,
              line_end: end,
              total_lines: total,
              done: end >= total,
            },
            null,
            2
          ) + "\n\n" + body,
      };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  },
});

