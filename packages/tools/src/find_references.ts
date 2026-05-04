/**
 * Lexical find-references across project text files (fast path without LSP).
 */
import { readFile, readdir } from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import { resolveWorkspaceRoot } from "@liminal/core";
import { defineTool } from "./helpers.js";

const TEXT_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md"]);

async function walkFiles(root: string, max: number): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    if (out.length >= max) return;
    let entries: Dirent[];
    try {
      entries = (await readdir(dir, { withFileTypes: true })) as Dirent[];
    } catch {
      return;
    }
    for (const ent of entries) {
      if (out.length >= max) return;
      if (ent.name.startsWith(".") || ent.name === "node_modules" || ent.name === "dist") continue;
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) await walk(p);
      else if (ent.isFile()) {
        const ext = path.extname(ent.name);
        if (TEXT_EXT.has(ext)) out.push(p);
      }
    }
  }
  await walk(root);
  return out;
}

export const findReferencesTool = defineTool({
  name: "find_references",
  description:
    "WHAT: Search for a symbol string across text sources under a directory (line-based hits).\n" +
    "WHEN: Quick references before deeper TS analysis.\n" +
    "ARGS: symbol — text to search; root — directory (default .); max_files — scan cap (default 80).",
  requiresApproval: false,
  dangerLevel: "safe",
  cacheable: true,
  cacheTtlMs: 25_000,
  parameters: {
    type: "object",
    properties: {
      symbol: { type: "string", description: "Symbol / substring to locate" },
      root: { type: "string", description: "Root directory" },
      max_files: { type: "number", description: "Max files to scan" },
    },
    required: ["symbol"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const symbol = (args["symbol"] as string).trim();
    if (symbol.length < 2) return { ok: false, error: "symbol too short" };
    const ws = resolveWorkspaceRoot();
    const root = path.resolve(ws, (args["root"] as string | undefined) ?? ".");
    const maxFiles = Math.min(400, Math.max(10, (args["max_files"] as number | undefined) ?? 80));
    const files = await walkFiles(root, maxFiles);
    const hits: string[] = [];
    for (const fp of files) {
      let text: string;
      try {
        text = await readFile(fp, "utf8");
      } catch {
        continue;
      }
      if (!text.includes(symbol)) continue;
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (lines[i]!.includes(symbol)) {
          hits.push(`${path.relative(ws, fp)}:${i + 1}: ${lines[i]!.trim().slice(0, 200)}`);
          if (hits.length >= 120) break;
        }
      }
      if (hits.length >= 120) break;
    }
    return {
      ok: true,
      output: hits.length ? hits.join("\n") : `(no references to "${symbol}" in scanned files)`,
    };
  },
});
