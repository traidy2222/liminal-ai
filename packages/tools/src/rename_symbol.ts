/**
 * rename_symbol — semantic, project-wide rename of a TypeScript / JavaScript
 * symbol via the TS LanguageService (`findRenameLocations`).
 *
 * Unlike grep + N×edit_file, this is scope-aware: it renames the binding and
 * every reference (including re-exports) and leaves unrelated same-named
 * symbols and string/comment occurrences untouched. Defaults to a dry run that
 * reports the change set without writing.
 *
 * Limits: TS/JS only, and scoped to a single tsconfig — a rename that must
 * cross package boundaries needs one call per package tsconfig.
 */
import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import ts from "typescript";
import { resolveWorkspaceRoot } from "@liminal/core";
import { defineTool } from "./helpers.js";

const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function normPath(p: string): string {
  return p.replace(/\\/g, "/");
}

/** Build a LanguageService over the files covered by a parsed tsconfig. */
function createLanguageService(
  rootNames: string[],
  options: ts.CompilerOptions,
  cwd: string
): ts.LanguageService {
  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => rootNames,
    getScriptVersion: () => "1",
    getScriptSnapshot: (fileName) => {
      const text = ts.sys.readFile(fileName);
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
    },
    getCurrentDirectory: () => cwd,
    getCompilationSettings: () => options,
    getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  };
  return ts.createLanguageService(host, ts.createDocumentRegistry());
}

/** Find the start offset of an identifier named `name` (optionally on a 1-based line). */
function findIdentifierPos(sf: ts.SourceFile, name: string, line?: number): number | null {
  let pos: number | null = null;
  const visit = (node: ts.Node): void => {
    if (pos !== null) return;
    if (ts.isIdentifier(node) && node.text === name) {
      const start = node.getStart(sf);
      if (line === undefined) {
        pos = start;
        return;
      }
      const lc = sf.getLineAndCharacterOfPosition(start);
      if (lc.line + 1 === line) {
        pos = start;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return pos;
}

export const renameSymbolTool = defineTool({
  name: "rename_symbol",
  description:
    "WHAT: Semantically rename a TypeScript/JavaScript symbol and every reference " +
    "(incl. re-exports) across one tsconfig project, via the TS language service.\n" +
    "WHEN: Renaming a function/class/interface/variable/type — replaces the " +
    "grep + edit-each-file loop with a scope-aware rename.\n" +
    "NOT WHEN: Non-TS/JS files; renames that span multiple package tsconfigs " +
    "(call once per package); pure text substitution (use edit_file).\n" +
    "ARGS: file — a file containing the symbol; symbol — current name; new_name; " +
    "line — optional 1-based line to disambiguate; dry_run — preview only " +
    "(default true); cwd — directory whose tsconfig defines the project (default '.').",
  requiresApproval: false,
  dangerLevel: "cautious",
  parameters: {
    type: "object",
    properties: {
      file: { type: "string", description: "Path to a file containing the symbol (relative to workspace root or absolute)" },
      symbol: { type: "string", description: "Current symbol name" },
      new_name: { type: "string", description: "New symbol name (valid JS identifier)" },
      line: { type: "number", description: "Optional 1-based line to disambiguate which occurrence of the symbol to rename" },
      dry_run: { type: "boolean", description: "Preview the change set without writing (default true)" },
      cwd: { type: "string", description: "Directory whose tsconfig.json defines the project (default '.')" },
    },
    required: ["file", "symbol", "new_name"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const symbol = (args["symbol"] as string).trim();
    const newName = (args["new_name"] as string).trim();
    const line = args["line"] as number | undefined;
    const dryRun = (args["dry_run"] as boolean | undefined) ?? true;
    const ws = resolveWorkspaceRoot();

    if (!IDENT_RE.test(newName)) {
      return { ok: false, error: `new_name "${newName}" is not a valid JS identifier` };
    }
    if (symbol === newName) {
      return { ok: false, error: "symbol and new_name are identical" };
    }

    const cwd = path.resolve(ws, (args["cwd"] as string | undefined) ?? ".");
    const targetFile = path.resolve(ws, args["file"] as string);

    const cfgPath = ts.findConfigFile(cwd, ts.sys.fileExists, "tsconfig.json");
    if (!cfgPath) {
      return { ok: false, error: `No tsconfig.json found under cwd "${cwd}"` };
    }
    const read = ts.readConfigFile(cfgPath, ts.sys.readFile);
    if (read.error) {
      const m = read.error.messageText;
      return { ok: false, error: typeof m === "string" ? m : JSON.stringify(m) };
    }
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(cfgPath), undefined, cfgPath);

    let service: ts.LanguageService;
    try {
      service = createLanguageService(parsed.fileNames, parsed.options, path.dirname(cfgPath));
    } catch (err) {
      return { ok: false, error: `Failed to start TS language service: ${String(err)}` };
    }
    const program = service.getProgram();
    if (!program) {
      return { ok: false, error: "TS program could not be created" };
    }

    // Locate the target source file within the program (slash/case tolerant).
    const wantPath = normPath(targetFile).toLowerCase();
    const targetSf = program
      .getSourceFiles()
      .find((sf) => normPath(sf.fileName).toLowerCase() === wantPath);
    if (!targetSf) {
      return {
        ok: false,
        error:
          `File "${path.relative(ws, targetFile)}" is not part of the tsconfig at ${path.relative(ws, cfgPath)}. ` +
          `Pass a cwd whose tsconfig includes the file.`,
      };
    }

    const pos = findIdentifierPos(targetSf, symbol, line);
    if (pos === null) {
      return {
        ok: false,
        error:
          `No identifier "${symbol}"${line ? ` on line ${line}` : ""} found in ${path.relative(ws, targetFile)}.`,
      };
    }

    const locations = service.findRenameLocations(targetSf.fileName, pos, false, false, {});
    if (!locations || locations.length === 0) {
      return { ok: false, error: `No rename locations resolved for "${symbol}" (symbol may be ambient or external).` };
    }

    // Group locations by file.
    const byFile = new Map<string, ts.RenameLocation[]>();
    for (const loc of locations) {
      const key = loc.fileName;
      const list = byFile.get(key) ?? [];
      list.push(loc);
      byFile.set(key, list);
    }

    const summary: string[] = [];
    const writes: Array<{ file: string; content: string }> = [];
    let totalEdits = 0;

    for (const [fileName, locs] of byFile) {
      let text: string;
      try {
        text = await readFile(fileName, "utf8");
      } catch (err) {
        return { ok: false, error: `Cannot read ${fileName}: ${String(err)}` };
      }
      const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
      // Apply spans from end → start so earlier offsets stay valid.
      const sorted = [...locs].sort((a, b) => b.textSpan.start - a.textSpan.start);
      let next = text;
      for (const loc of sorted) {
        const start = loc.textSpan.start;
        const end = start + loc.textSpan.length;
        const replacement = (loc.prefixText ?? "") + newName + (loc.suffixText ?? "");
        next = next.slice(0, start) + replacement + next.slice(end);
      }
      writes.push({ file: fileName, content: next });
      totalEdits += locs.length;
      const rel = path.relative(ws, fileName);
      const lineNos = locs
        .map((l) => sf.getLineAndCharacterOfPosition(l.textSpan.start).line + 1)
        .sort((a, b) => a - b);
      summary.push(`  ${rel} — ${locs.length} edit(s) at line(s): ${lineNos.join(", ")}`);
    }

    const header = `rename "${symbol}" → "${newName}": ${totalEdits} edit(s) across ${byFile.size} file(s)`;
    const body = summary.slice(0, 60).join("\n");
    const more = summary.length > 60 ? `\n  …and ${summary.length - 60} more file(s)` : "";

    if (dryRun) {
      return {
        ok: true,
        output: `${header}\n${body}${more}\n\n[dry run — nothing written. Call again with dry_run:false to apply.]`,
      };
    }

    for (const w of writes) {
      try {
        await writeFile(w.file, w.content, "utf8");
      } catch (err) {
        return { ok: false, error: `Applied partially — write failed for ${w.file}: ${String(err)}` };
      }
    }
    return { ok: true, output: `${header}\n${body}${more}\n\nApplied to ${writes.length} file(s).` };
  },
});
