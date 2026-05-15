import { readFile } from "node:fs/promises";
import path from "node:path";
import { defineTool } from "./helpers.js";
import { effectiveHarnessEnvRaw } from "@liminal/core";

/** Resolve local import specifiers from TS/JS source (same-dir relative only). */
function extractLocalImportPaths(mainPath: string, source: string): string[] {
  const dir = path.dirname(mainPath);
  const out: string[] = [];
  const re =
    /(?:from|import)\s+["'](\.[^"']+)["']|import\s*\(\s*["'](\.[^"']+)["']\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const spec = (m[1] ?? m[2])?.trim();
    if (!spec || !spec.startsWith(".")) continue;
    const abs = path.normalize(path.join(dir, spec));
    if (!out.includes(abs)) out.push(abs);
    if (out.length >= 8) break;
  }
  return out.slice(0, 5);
}

export const readFileTool = defineTool({
  name: "read_file",
  description:
    "WHAT: Read text contents of a file from disk, optionally a line range.\n" +
    "WHEN: You know the exact path and need to inspect or process the file's content.\n" +
    "NOT WHEN: File existence is uncertain — use list_dir first to confirm the path. NOT WHEN: You only need existence/size — avoid loading huge bodies.\n" +
    "GOOD OUTPUT: You can quote or reason about specific lines; cite the path in the user reply when the task is file-backed (R-CITE-PATHS).\n" +
    "ARGS: path — absolute or relative file path; offset — 1-based start line (default: 1); limit — max lines to return (default: all); encoding — optional (default: utf8).\n" +
    "line_numbers — when true, prefix each returned line with its 1-based absolute line number (matches browser stack traces like file.html:224:20). Use offset≈reported line with a small limit. For full-file reads, line_numbers is refused above 2000 lines unless limit is set.",
  requiresApproval: false,
  cacheable: true,
  cacheTtlMs: 30_000,
  resourceLocks: (args) => [`file:read:${args["path"] as string}`],
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute or relative file path" },
      offset: { type: "number", description: "1-based line number to start reading from (default: 1)." },
      limit: { type: "number", description: "Maximum number of lines to return (default: all)." },
      encoding: { type: "string", description: "File encoding (default: utf8)" },
      line_numbers: {
        type: "boolean",
        description:
          "If true, prefix each line with 7-digit 1-based line number + '|' (absolute file lines). Matches browser JS error locations. Combine with offset/limit around the reported line.",
      },
    },
    required: ["path"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const filePath = args["path"] as string;
    const encoding = (args["encoding"] as BufferEncoding | undefined) ?? "utf8";
    const offsetArg = args["offset"] != null ? Math.max(1, Number(args["offset"])) : 1;
    const limitArg = args["limit"] != null ? Math.max(1, Number(args["limit"])) : null;
    const lineNumbers = args["line_numbers"] === true;
    try {
      let content = await readFile(filePath, { encoding });
      const allLines = content.split("\n");

      if (lineNumbers && limitArg == null && allLines.length > 2000) {
        return {
          ok: false,
          error: `read_file line_numbers: file has ${allLines.length} lines (max 2000 without limit). Pass limit (e.g. limit=80) and offset near the browser-reported line.`,
        };
      }

      const start = offsetArg - 1;
      const end = limitArg != null ? start + limitArg : allLines.length;
      const slice = allLines.slice(start, end);
      const truncated = end < allLines.length;

      if (lineNumbers) {
        const numbered = slice.map((line, i) => `${String(start + i + 1).padStart(7, " ")}|${line}`).join("\n");
        const colHint =
          "\n[hint] Stack trace :COLUMN is 1-based on the source text only (characters after | on each line; do not count the line-number gutter).";
        content =
          numbered +
          (truncated
            ? `\n... (${allLines.length - end} more lines, use offset=${end + 1} with line_numbers=true to continue)${colHint}`
            : `${colHint}`);
      } else if (offsetArg > 1 || limitArg != null) {
        content =
          slice.join("\n") +
          (truncated ? `\n... (${allLines.length - end} more lines, use offset=${end + 1} to continue)` : "");
      }

      // Speculative reads would append other files without line numbers — skip when aligning to browser line refs.
      if (effectiveHarnessEnvRaw("AGENT_SPECULATIVE_READS") === "1" && !lineNumbers) {
        const extra = extractLocalImportPaths(filePath, content);
        const chunks: string[] = [content];
        let n = 0;
        for (const rel of extra) {
          if (n >= 3) break;
          const candidates = [rel, rel + ".ts", rel + ".tsx", rel + ".js", rel + ".mjs"];
          let sub: string | null = null;
          let used = rel;
          for (const c of candidates) {
            try {
              sub = await readFile(c, { encoding });
              used = c;
              break;
            } catch {
              /* try next */
            }
          }
          if (sub != null) {
            chunks.push(`\n\n--- [speculative: ${used}] ---\n\n` + sub.slice(0, 12_000));
            n++;
          }
        }
        content = chunks.join("");
      }
      return { ok: true, output: content };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  },
});
