/**
 * Run package test script with structured capture.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { readFile, access } from "node:fs/promises";
import { resolveWorkspaceRoot } from "@liminal/core";
import { defineTool } from "../../shared/helpers.js";

const execFileAsync = promisify(execFile);

export const runTestsTool = defineTool({
  name: "run_tests",
  description:
    "WHAT: Run `npm test` (or custom script) in a workspace directory and return stdout/stderr.\n" +
    "WHEN: Verifying changes after edits.\n" +
    "ARGS: cwd — required working directory; script — npm script name (default test).",
  requiresApproval: true,
  dangerLevel: "cautious",
  resourceLocks: (args) => [
    `shell:${(args["cwd"] as string | undefined) ?? process.cwd()}`,
  ],
  parameters: {
    type: "object",
    properties: {
      cwd: { type: "string", description: "Working directory (required)" },
      script: {
        type: "string",
        description: "npm script name (default: test)",
      },
      env: {
        type: "object",
        description:
          "Extra environment variables merged into the test process env (string values only)",
      },
    },
    required: ["cwd"],
    additionalProperties: false,
  },
  handler: async (args, emit) => {
    const cwd = path.resolve(resolveWorkspaceRoot(), args["cwd"] as string);
    const script = (args["script"] as string | undefined)?.trim() || "test";
    if (!/^[a-zA-Z0-9_:@./-]+$/.test(script))
      return { ok: false, error: "Invalid npm script name" };
    try {
      const pkg = JSON.parse(
        await readFile(path.join(cwd, "package.json"), "utf8"),
      );
      if (
        typeof pkg.scripts?.[script] !== "string" ||
        !pkg.scripts[script].trim()
      ) {
        return {
          ok: false,
          error: `Required test script '${script}' is missing from ${cwd}/package.json; verification did not run.`,
        };
      }
    } catch (e) {
      return {
        ok: false,
        error: `Cannot load test configuration: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
    const extraEnv = (args["env"] as Record<string, string> | undefined) ?? {};
    let executable = "npm";
    let commandArgs = ["run", script, "--"];
    if (process.platform === "win32") {
      const candidates = [
        process.env["npm_execpath"] ?? "",
        path.join(
          path.dirname(process.execPath),
          "node_modules",
          "npm",
          "bin",
          "npm-cli.js",
        ),
        ...(process.env["PATH"] ?? "")
          .split(path.delimiter)
          .map((p) => path.join(p, "node_modules", "npm", "bin", "npm-cli.js")),
      ];
      let cli: string | undefined;
      for (const candidate of candidates) {
        if (path.basename(candidate) !== "npm-cli.js") continue;
        try {
          await access(candidate);
          cli = candidate;
          break;
        } catch {}
      }
      if (!cli)
        return {
          ok: false,
          error:
            "Cannot locate npm-cli.js. Install Node.js with npm, then restart Liminal.",
        };
      executable = process.execPath;
      commandArgs = [cli, ...commandArgs];
    }
    const childEnv = { ...process.env, ...extraEnv };
    // A test runner hosting Liminal must not make child tests silently skip as recursive.
    delete childEnv["NODE_TEST_CONTEXT"];
    emit?.(`\nrun_tests: npm run ${script} in ${cwd}\n`);
    try {
      const { stdout, stderr } = await execFileAsync(executable, commandArgs, {
        cwd,
        maxBuffer: 6_000_000,
        timeout: 600_000,
        env: childEnv,
      });
      return {
        ok: true,
        output: (stdout + "\n" + stderr).trim().slice(0, 40_000),
      };
    } catch (err: unknown) {
      const e = err as {
        stdout?: string;
        stderr?: string;
        code?: number;
        message?: string;
      };
      const out = `${e.stdout ?? ""}\n${e.stderr ?? ""}`.trim();
      return {
        ok: false,
        error: `exit ${e.code ?? "?"}: ${e.message ?? String(err)}\n${out.slice(0, 12_000)}`,
      };
    }
  },
});
