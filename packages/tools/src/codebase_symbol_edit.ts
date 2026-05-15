import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { defineTool } from "./helpers.js";
import { resolveWorkspaceRoot } from "@liminal/core";

interface Span {
  start: number;
  end: number;
}

function collectIdentifierSpans(source: ts.SourceFile, symbol: string): Span[] {
  const spans: Span[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && node.text === symbol) {
      spans.push({ start: node.getStart(source), end: node.getEnd() });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return spans;
}

function replaceSpans(input: string, spans: Span[], replacement: string): string {
  if (spans.length === 0) return input;
  const ordered = [...spans].sort((a, b) => b.start - a.start);
  let out = input;
  for (const s of ordered) {
    out = `${out.slice(0, s.start)}${replacement}${out.slice(s.end)}`;
  }
  return out;
}

function isCodeFile(p: string): boolean {
  const ext = path.extname(p).toLowerCase();
  return ext === ".ts" || ext === ".tsx" || ext === ".js" || ext === ".jsx" || ext === ".mts" || ext === ".cts";
}

export const codebaseSymbolEditTool = defineTool({
  name: "codebase_symbol_edit",
  description:
    "WHAT: Rename an identifier across specified code files using AST identifier matching (not plain regex).\n" +
    "WHEN: You need a safer cross-file symbol rename with optional dry-run preview.\n" +
    "NOT WHEN: You do not know the exact files; gather paths first with search/index tools.\n" +
    "ARGS: symbol, new_name, files, dry_run.",
  requiresApproval: true,
  dangerLevel: "destructive",
  resourceLocks: () => ["file:write:codebase_symbol_edit"],
  parameters: {
    type: "object",
    properties: {
      symbol: { type: "string", description: "Exact identifier name to replace." },
      new_name: { type: "string", description: "New identifier name." },
      files: {
        type: "array",
        items: { type: "string" },
        description: "Explicit list of code files to process.",
      },
      dry_run: {
        type: "boolean",
        description: "If true, report changes without writing files (default true).",
      },
      max_files: {
        type: "number",
        description: "Safety cap on number of files (default 80, max 400).",
      },
    },
    required: ["symbol", "new_name", "files"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const symbol = String(args["symbol"] ?? "").trim();
    const newName = String(args["new_name"] ?? "").trim();
    const files = ((args["files"] as string[] | undefined) ?? []).map((f) => String(f).trim()).filter(Boolean);
    const dryRun = args["dry_run"] !== false;
    const maxFiles = Math.max(1, Math.min(400, Math.round(Number(args["max_files"] ?? 80))));
    if (!/^[$A-Z_a-z][$\w]*$/.test(symbol)) {
      return { ok: false, error: `Invalid symbol "${symbol}". Expected identifier token.` };
    }
    if (!/^[$A-Z_a-z][$\w]*$/.test(newName)) {
      return { ok: false, error: `Invalid new_name "${newName}". Expected identifier token.` };
    }
    if (symbol === newName) return { ok: false, error: "symbol and new_name are identical." };
    if (files.length === 0) return { ok: false, error: "files must include at least one path." };
    if (files.length > maxFiles) return { ok: false, error: `Refusing to process ${files.length} files (max_files=${maxFiles}).` };

    const ws = resolveWorkspaceRoot();
    const report: Array<{ file: string; replacements: number }> = [];
    let processed = 0;
    for (const raw of files) {
      const abs = path.resolve(ws, raw);
      if (!isCodeFile(abs)) continue;
      let content: string;
      try {
        content = await readFile(abs, "utf8");
      } catch {
        continue;
      }
      const sf = ts.createSourceFile(abs, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const spans = collectIdentifierSpans(sf, symbol);
      if (spans.length === 0) continue;
      processed += 1;
      report.push({ file: raw, replacements: spans.length });
      if (!dryRun) {
        const next = replaceSpans(content, spans, newName);
        await writeFile(abs, next, "utf8");
      }
    }

    const mode = dryRun ? "dry_run" : "write";
    const totalReplacements = report.reduce((sum, x) => sum + x.replacements, 0);
    const lines = report.slice(0, 60).map((r) => `- ${r.file}: ${r.replacements}`);
    const suffix = report.length > 60 ? `\n...and ${report.length - 60} more files` : "";
    return {
      ok: true,
      output:
        `codebase_symbol_edit (${mode}) complete\n` +
        `symbol: ${symbol} -> ${newName}\n` +
        `files_changed: ${processed}\n` +
        `identifier_replacements: ${totalReplacements}\n` +
        (lines.length > 0 ? `changes:\n${lines.join("\n")}${suffix}` : "changes:\n(none)"),
    };
  },
});
