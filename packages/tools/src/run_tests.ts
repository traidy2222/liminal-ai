/**
 * Run package test script with structured capture.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { resolveWorkspaceRoot } from "@liminal/core";
import { defineTool } from "./helpers.js";

const execFileAsync = promisify(execFile);

export const runTestsTool = defineTool({
  name: "run_tests",
  description:
    "WHAT: Run `npm test` (or custom script) in a workspace directory and return stdout/stderr.\n" +
    "WHEN: Verifying changes after edits.\n" +
    "ARGS: cwd — required working directory; script — npm script name (default test).",
  requiresApproval: true,
  dangerLevel: "cautious",
  resourceLocks: (args) => [`shell:${(args["cwd"] as string | undefined) ?? "cwd"}`],
  parameters: {
    type: "object",
    properties: {
      cwd: { type: "string", description: "Working directory (required)" },
      script: { type: "string", description: "npm script name (default: test)" },
    },
    required: ["cwd"],
    additionalProperties: false,
  },
  handler: async (args, emit) => {
    const cwd = path.resolve(resolveWorkspaceRoot(), args["cwd"] as string);
    const script = (args["script"] as string | undefined)?.trim() || "test";
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    emit?.(`\nrun_tests: npm run ${script} in ${cwd}\n`);
    try {
      const { stdout, stderr } = await execFileAsync(
        npm,
        ["run", script, "--if-present", "--"],
        { cwd, maxBuffer: 6_000_000, timeout: 600_000 }
      );
      return {
        ok: true,
        output: (stdout + "\n" + stderr).trim().slice(0, 40_000),
      };
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; code?: number; message?: string };
      const out = `${e.stdout ?? ""}\n${e.stderr ?? ""}`.trim();
      return {
        ok: false,
        error: `exit ${e.code ?? "?"}: ${e.message ?? String(err)}\n${out.slice(0, 12_000)}`,
      };
    }
  },
});
