/**
 * Syntactic search via ast-grep CLI (optional binary via npx).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { defineTool } from "./helpers.js";

const execFileAsync = promisify(execFile);

export const astGrepTool = defineTool({
  name: "ast_grep",
  description:
    "WHAT: Run ast-grep / sg pattern search over source files.\n" +
    "WHEN: You need syntax-aware search (functions, imports) beyond text grep.\n" +
    "NOT WHEN: ast-grep is not installed — falls back to suggesting `npm i -D @ast-grep/cli`.\n" +
    "ARGS: pattern — ast-grep rule; path — root to scan (default .); lang — optional language id (e.g. ts, tsx).",
  requiresApproval: false,
  dangerLevel: "safe",
  cacheable: true,
  cacheTtlMs: 20_000,
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "ast-grep pattern" },
      path: { type: "string", description: "Directory or file root (default cwd)" },
      lang: { type: "string", description: "Language filter (optional)" },
    },
    required: ["pattern"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const pattern = args["pattern"] as string;
    const root = path.resolve(process.cwd(), (args["path"] as string | undefined) ?? ".");
    const lang = (args["lang"] as string | undefined)?.trim();
    const npx = process.platform === "win32" ? "npx.cmd" : "npx";
    const argv = ["--yes", "@ast-grep/cli", ...(lang ? ["-l", lang] : []), "-p", pattern, root];
    try {
      const { stdout, stderr } = await execFileAsync(npx, argv, {
        cwd: process.cwd(),
        maxBuffer: 4_000_000,
        timeout: 90_000,
      });
      const out = (stdout + "\n" + stderr).trim();
      return { ok: true, output: out.slice(0, 28_000) || "(no matches)" };
    } catch (err: unknown) {
      const e = err as { stderr?: string; message?: string };
      const hint =
        "Install CLI: `npm i -D @ast-grep/cli` or ensure npx can download packages.";
      return {
        ok: false,
        error: `${e.message ?? String(err)}\n${e.stderr ?? ""}\n${hint}`,
      };
    }
  },
});
