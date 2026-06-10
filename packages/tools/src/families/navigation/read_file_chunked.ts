import { readFile } from "node:fs/promises";
import { defineTool } from "../../shared/helpers.js";
import { resolveWithinWorkspace } from "../../shared/file_path_guard.js";

export const readFileChunkedTool = defineTool({
  name: "read_file_chunked",
  description:
    "WHAT: Read a file in deterministic chunks by line range.\n" +
    "WHEN: File is too large for one read or you need progressive context.\n" +
    "NOT WHEN: You know the exact line range — prefer read_file with offset + limit + line_numbers (same workspace resolution, clearer API).\n" +
    "ARGS: path — workspace-relative file path; chunk_index — 0-based chunk number (NOT a line number); chunk_lines — lines per chunk (default 200); " +
    "offset — optional 1-based start line (overrides chunk_index when set); limit — optional max lines when offset is set (default chunk_lines).",
  requiresApproval: false,
  cacheable: true,
  cacheTtlMs: 15_000,
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Workspace-relative file path." },
      chunk_index: {
        type: "number",
        description: "0-based chunk index (chunk 0 = lines 1..chunk_lines). Not a line number — use offset for that.",
      },
      chunk_lines: { type: "number", description: "Lines per chunk when using chunk_index (default 200)." },
      offset: {
        type: "number",
        description: "1-based start line (same as read_file). When set, reads offset..offset+limit-1 and ignores chunk_index.",
      },
      limit: {
        type: "number",
        description: "Max lines to return with offset (default: chunk_lines).",
      },
    },
    required: ["path"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const safe = resolveWithinWorkspace(String(args["path"] ?? ""));
    if (!safe.ok || !safe.resolvedPath) return { ok: false, error: safe.error ?? "invalid path" };
    const chunkIndex = Math.max(0, Number(args["chunk_index"] ?? 0) || 0);
    const chunkLines = Math.max(20, Math.min(1000, Number(args["chunk_lines"] ?? 200) || 200));
    const offsetLine =
      args["offset"] != null && Number.isFinite(Number(args["offset"]))
        ? Math.max(1, Number(args["offset"]))
        : null;
    const limitLines =
      args["limit"] != null && Number.isFinite(Number(args["limit"]))
        ? Math.max(1, Math.min(2000, Number(args["limit"])))
        : chunkLines;
    try {
      const content = await readFile(safe.resolvedPath, "utf8");
      const lines = content.split(/\r?\n/);
      const total = lines.length;

      let start: number;
      let end: number;
      let mode: "offset" | "chunk_index";
      if (offsetLine != null) {
        mode = "offset";
        start = offsetLine - 1;
        end = Math.min(total, start + limitLines);
      } else {
        mode = "chunk_index";
        start = chunkIndex * chunkLines;
        end = Math.min(total, start + chunkLines);
      }

      if (start >= total) {
        const hint =
          mode === "chunk_index" && chunkIndex > 0
            ? " chunk_index is 0-based (not a line number). For a specific line, use offset=LINE with limit=N, or read_file with offset/limit."
            : "";
        return {
          ok: true,
          output: JSON.stringify(
            {
              path: safe.resolvedPath,
              mode,
              chunk_index: chunkIndex,
              offset: offsetLine,
              total_lines: total,
              done: true,
              hint: hint || undefined,
            },
            null,
            2
          ),
        };
      }

      const body = lines.slice(start, end).join("\n");
      return {
        ok: true,
        output:
          JSON.stringify(
            {
              path: safe.resolvedPath,
              mode,
              chunk_index: mode === "chunk_index" ? chunkIndex : undefined,
              offset: mode === "offset" ? offsetLine : undefined,
              chunk_lines: mode === "chunk_index" ? chunkLines : undefined,
              limit: mode === "offset" ? limitLines : undefined,
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
