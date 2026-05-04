import { readFile } from "node:fs/promises";
import path from "node:path";
import { defineTool } from "./helpers.js";

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
    const filePath = args["path"] as string;
    const encoding = (args["encoding"] as BufferEncoding | undefined) ?? "utf8";
    try {
      let content = await readFile(filePath, { encoding });
      if (process.env["AGENT_SPECULATIVE_READS"] === "1") {
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
