import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveWorkspaceRoot } from "@liminal/core";
import { defineTool } from "../../shared/helpers.js";
import { resolveWithinWorkspace } from "../../shared/file_path_guard.js";

function extractImports(mainPath: string, source: string): string[] {
  const dir = path.dirname(mainPath);
  const out: string[] = [];
  const re = /(?:from|import)\s+["'](\.[^"']+)["']|import\s*\(\s*["'](\.[^"']+)["']\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const spec = (m[1] ?? m[2])?.trim();
    if (!spec || !spec.startsWith(".")) continue;
    const abs = path.normalize(path.join(dir, spec));
    if (!out.includes(abs)) out.push(abs);
    if (out.length >= 16) break;
  }
  return out;
}

async function readWithExtensions(base: string): Promise<{ path: string; content: string } | null> {
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.mjs`, path.join(base, "index.ts"), path.join(base, "index.js")];
  for (const c of candidates) {
    try {
      return { path: c, content: await readFile(c, "utf8") };
    } catch {
      // continue
    }
  }
  return null;
}

export const readFileWithImportsTool = defineTool({
  name: "read_file_with_imports",
  description:
    "WHAT: Read one file plus resolved local imports (depth-limited).\n" +
    "WHEN: Understanding code flow without many manual read_file calls.",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Entry file path." },
      depth: { type: "number", description: "Import depth (default 1, max 2)." },
      max_files: { type: "number", description: "Max files total (default 6)." },
    },
    required: ["path"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const safe = resolveWithinWorkspace(String(args["path"] ?? ""));
    if (!safe.ok || !safe.resolvedPath) return { ok: false, error: safe.error ?? "invalid path" };
    const maxDepth = Math.max(0, Math.min(2, Number(args["depth"] ?? 1) || 1));
    const maxFiles = Math.max(1, Math.min(20, Number(args["max_files"] ?? 6) || 6));
    const visited = new Set<string>();
    const queue: Array<{ p: string; d: number }> = [{ p: safe.resolvedPath, d: 0 }];
    const out: string[] = [];
    while (queue.length > 0 && visited.size < maxFiles) {
      const cur = queue.shift()!;
      if (visited.has(cur.p)) continue;
      const loaded = await readWithExtensions(cur.p);
      if (!loaded) continue;
      visited.add(loaded.path);
      out.push(`--- FILE: ${loaded.path} ---\n${loaded.content}`);
      if (cur.d >= maxDepth) continue;
      const imports = extractImports(loaded.path, loaded.content);
      for (const imp of imports) {
        const resolved = path.resolve(path.dirname(loaded.path), imp);
        const rel = path.relative(path.resolve(resolveWorkspaceRoot()), resolved);
        const guard = resolveWithinWorkspace(rel);
        if (guard.ok && guard.resolvedPath) queue.push({ p: guard.resolvedPath, d: cur.d + 1 });
      }
    }
    return { ok: true, output: out.join("\n\n") || "(no files read)" };
  },
});

