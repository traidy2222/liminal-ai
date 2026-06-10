/**
 * execute_code — run short Python/JavaScript snippets with bounded resources.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { resolveWorkspaceRoot, type ToolResult } from "@liminal/core";
import { defineTool } from "../../shared/helpers.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 200_000;

function resolveCwd(cwd?: string): string {
  if (!cwd) return resolveWorkspaceRoot();
  const ws = resolveWorkspaceRoot();
  const abs = path.resolve(ws, cwd);
  const rel = path.relative(ws, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("cwd must stay inside the workspace root.");
  }
  return abs;
}

function trimOutput(s: string): { text: string; truncated: boolean } {
  if (Buffer.byteLength(s, "utf8") <= MAX_OUTPUT_BYTES) {
    return { text: s, truncated: false };
  }
  const text = s.slice(0, MAX_OUTPUT_BYTES);
  return { text, truncated: true };
}

function executeSnippet(
  command: string,
  cmdArgs: string[],
  cwd: string,
  timeoutMs: number
): Promise<ToolResult> {
  return new Promise((resolve) => {
    const child = spawn(command, cmdArgs, {
      cwd,
      stdio: "pipe",
      shell: false,
      windowsHide: true,
    });
    const startedAt = Date.now();
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let killedByOutputCap = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    const appendBounded = (current: string, chunk: Buffer): string => {
      const next = current + chunk.toString();
      if (Buffer.byteLength(next, "utf8") > MAX_OUTPUT_BYTES) {
        killedByOutputCap = true;
        child.kill("SIGTERM");
      }
      return next;
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = appendBounded(stdout, chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = appendBounded(stderr, chunk);
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: `Failed to start runtime: ${err.message}` });
    });

    child.on("close", (exitCode) => {
      clearTimeout(timer);
      const elapsedMs = Date.now() - startedAt;
      const out = trimOutput(stdout);
      const err = trimOutput(stderr);
      const envelope = {
        runtime: command,
        exit_code: exitCode ?? -1,
        elapsed_ms: elapsedMs,
        timed_out: timedOut,
        output_capped: killedByOutputCap || out.truncated || err.truncated,
        stdout: out.text,
        stderr: err.text,
      };
      const serialized = JSON.stringify(envelope, null, 2);
      if (timedOut) {
        resolve({ ok: false, error: serialized });
        return;
      }
      if (killedByOutputCap) {
        resolve({ ok: false, error: serialized });
        return;
      }
      if ((exitCode ?? 1) !== 0) {
        resolve({ ok: false, error: serialized });
        return;
      }
      resolve({ ok: true, output: serialized });
    });
  });
}

export const executeCodeTool = defineTool({
  name: "execute_code",
  description:
    "WHAT: Execute short Python or JavaScript snippets and return structured stdout/stderr JSON.\n" +
    "WHEN: Numeric calculations, simulation snippets, quick data transforms.\n" +
    "NOT WHEN: You need package installs, process orchestration, or broader shell access (use run_shell/run_background).\n" +
    "Requires user approval.\n" +
    "ARGS: language (python|javascript), code, optional timeout_ms, optional cwd (workspace-relative).",
  requiresApproval: true,
  dangerLevel: "destructive",
  resourceLocks: (args) => {
    const cwd = (args["cwd"] as string | undefined) ?? ".";
    return [`shell:${cwd}`];
  },
  parameters: {
    type: "object",
    properties: {
      language: {
        type: "string",
        enum: ["python", "javascript"],
        description: "Runtime language",
      },
      code: {
        type: "string",
        minLength: 1,
        maxLength: 100_000,
        description: "Code snippet to execute",
      },
      timeout_ms: {
        type: "number",
        minimum: 1,
        maximum: MAX_TIMEOUT_MS,
        description: `Execution timeout in milliseconds (default ${DEFAULT_TIMEOUT_MS})`,
      },
      cwd: {
        type: "string",
        description: "Optional workspace-relative working directory",
      },
    },
    required: ["language", "code"],
    additionalProperties: false,
  },
  handler: async (args, emit) => {
    const language = args["language"] as "python" | "javascript";
    const code = String(args["code"] ?? "");
    const preview = code.trim().split("\n")[0]?.slice(0, 60) ?? "";
    emit?.(`\nexecute_code (${language}): ${preview}…\n`);
    const timeoutMs = Math.min(
      MAX_TIMEOUT_MS,
      Math.max(1, Number(args["timeout_ms"] ?? DEFAULT_TIMEOUT_MS))
    );
    const cwd = resolveCwd(args["cwd"] as string | undefined);

    if (language === "javascript") {
      return executeSnippet("node", ["-e", code], cwd, timeoutMs);
    }
    if (process.platform === "win32") {
      const pyLauncher = await executeSnippet("py", ["-3", "-c", code], cwd, timeoutMs);
      if (pyLauncher.ok || !/Failed to start runtime/i.test(pyLauncher.error)) {
        return pyLauncher;
      }
    }
    return executeSnippet("python", ["-c", code], cwd, timeoutMs);
  },
});
