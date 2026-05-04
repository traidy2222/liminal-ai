/**
 * Run TypeScript / ESLint-style checks with JSON-friendly output.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { defineTool } from "./helpers.js";

const execFileAsync = promisify(execFile);

export const runLintTool = defineTool({
  name: "run_lint",
  description:
    "WHAT: Run `npx tsc --noEmit` with optional -p project, or `npx eslint --format json`.\n" +
    "WHEN: Static validation after code edits.\n" +
    "ARGS: cwd — required; mode — tsc | eslint (default tsc); project — tsconfig path for tsc.",
  requiresApproval: true,
  dangerLevel: "cautious",
  resourceLocks: (args) => [`shell:${(args["cwd"] as string | undefined) ?? "cwd"}`],
  parameters: {
    type: "object",
    properties: {
      cwd: { type: "string", description: "Working directory (required)" },
      mode: { type: "string", enum: ["tsc", "eslint"], description: "Check mode (default tsc)" },
      project: { type: "string", description: "tsconfig path for tsc mode" },
      eslint_paths: {
        type: "array",
        items: { type: "string" },
        description: "Paths for eslint mode",
      },
    },
    required: ["cwd"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const cwd = path.resolve(process.cwd(), args["cwd"] as string);
    const mode = ((args["mode"] as string | undefined) ?? "tsc").toLowerCase();
    const npx = process.platform === "win32" ? "npx.cmd" : "npx";
    try {
      if (mode === "eslint") {
        const paths = (args["eslint_paths"] as string[] | undefined)?.length
          ? (args["eslint_paths"] as string[])
          : ["."];
        const { stdout, stderr } = await execFileAsync(
          npx,
          ["eslint", "--format", "json", ...paths],
          { cwd, maxBuffer: 6_000_000, timeout: 300_000 }
        );
        return { ok: true, output: (stdout || stderr).trim().slice(0, 40_000) };
      }
      const proj = args["project"] as string | undefined;
      const argv = ["tsc", "--noEmit"];
      if (proj) argv.push("-p", proj);
      const { stdout, stderr } = await execFileAsync(npx, argv, {
        cwd,
        maxBuffer: 6_000_000,
        timeout: 300_000,
      });
      return {
        ok: true,
        output: (stdout + "\n" + stderr).trim().slice(0, 40_000) || "(tsc ok)",
      };
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; code?: number; message?: string };
      const out = `${e.stdout ?? ""}\n${e.stderr ?? ""}`.trim();
      return {
        ok: false,
        error: `lint exit ${e.code ?? "?"}: ${e.message ?? String(err)}\n${out.slice(0, 20_000)}`,
      };
    }
  },
});
