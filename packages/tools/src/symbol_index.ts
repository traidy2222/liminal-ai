/**
 * Lightweight TS/JS symbol listing via TypeScript compiler API.
 */
import path from "node:path";
import ts from "typescript";
import { resolveWorkspaceRoot } from "@liminal/core";
import { defineTool } from "./helpers.js";

export const symbolIndexTool = defineTool({
  name: "symbol_index",
  description:
    "WHAT: List top-level exported declarations from TypeScript files covered by a tsconfig.\n" +
    "WHEN: Mapping exports before deeper reads.\n" +
    "ARGS: cwd — root containing tsconfig (default .); max_files — cap (default 35).",
  requiresApproval: false,
  dangerLevel: "safe",
  cacheable: true,
  cacheTtlMs: 60_000,
  parameters: {
    type: "object",
    properties: {
      cwd: { type: "string", description: "Directory containing tsconfig.json" },
      max_files: { type: "number", description: "Max source files to scan (default 35)" },
    },
    additionalProperties: false,
  },
  handler: async (args) => {
    const cwd = path.resolve(resolveWorkspaceRoot(), (args["cwd"] as string | undefined) ?? ".");
    const maxFiles = Math.min(120, Math.max(5, (args["max_files"] as number | undefined) ?? 35));
    const cfgPath = ts.findConfigFile(cwd, ts.sys.fileExists, "tsconfig.json");
    if (!cfgPath) {
      return { ok: false, error: "No tsconfig.json found under cwd" };
    }
    const read = ts.readConfigFile(cfgPath, ts.sys.readFile);
    if (read.error) {
      const msg = read.error.messageText;
      return { ok: false, error: typeof msg === "string" ? msg : JSON.stringify(msg) };
    }
    const parsed = ts.parseJsonConfigFileContent(
      read.config,
      ts.sys,
      path.dirname(cfgPath),
      undefined,
      cfgPath
    );
    const rootNames = parsed.fileNames.filter((f) => !f.endsWith(".d.ts")).slice(0, maxFiles);
    const program = ts.createProgram({
      rootNames,
      options: { ...parsed.options, noEmit: true },
    });
    const lines: string[] = [];
    for (const abs of rootNames) {
      const sf = program.getSourceFile(abs);
      if (!sf || sf.isDeclarationFile) continue;
      const rel = path.relative(cwd, sf.fileName);
      ts.forEachChild(sf, (node) => {
        if (
          ts.isFunctionDeclaration(node) &&
          node.name &&
          (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export)
        ) {
          lines.push(`${rel}: export function ${node.name.text}()`);
        } else if (ts.isClassDeclaration(node) && node.name) {
          const ex = ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export;
          if (ex) lines.push(`${rel}: export class ${node.name.text}`);
        } else if (ts.isInterfaceDeclaration(node) && node.name) {
          const ex = ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export;
          if (ex) lines.push(`${rel}: export interface ${node.name.text}`);
        } else if (ts.isVariableStatement(node)) {
          if (!node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) return;
          for (const d of node.declarationList.declarations) {
            if (ts.isIdentifier(d.name)) {
              lines.push(`${rel}: export const ${d.name.text}`);
            }
          }
        }
      });
    }
    return {
      ok: true,
      output: lines.length ? lines.slice(0, 400).join("\n") : "(no exported symbols found in scanned files)",
    };
  },
});
