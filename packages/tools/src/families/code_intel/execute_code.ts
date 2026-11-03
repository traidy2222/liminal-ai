/**
 * execute_code — run short Python/JavaScript snippets with bounded resources.
 */
import { spawn, execFile } from "node:child_process";
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
  timeoutMs: number,
  signal?: AbortSignal
): Promise<ToolResult> {
  if (signal?.aborted) return Promise.resolve({ ok: false, error: "Runtime cancelled before execution." });
  return new Promise((resolve) => {
    const child = spawn(command, cmdArgs, {
      cwd,
      stdio: "pipe",
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
    });
    const startedAt = Date.now();
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let killedByOutputCap = false;
    let cancelled = false;
    let settled = false;
    let forceTimer: ReturnType<typeof setTimeout> | undefined;
    let closeDeadline: ReturnType<typeof setTimeout> | undefined;

    const killTree = (force = false) => {
      if (!child.pid) return;
      if (process.platform === "win32") {
        execFile("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, timeout: 5000 }, (error) => {
          if (error && !settled) { try { child.kill("SIGKILL"); } catch {} }
        });
      } else {
        try { process.kill(-child.pid, force ? "SIGKILL" : "SIGTERM"); }
        catch { try { child.kill(force ? "SIGKILL" : "SIGTERM"); } catch {} }
      }
    };
    const stopChild = () => {
      if (closeDeadline) return;
      killTree();
      if (process.platform !== "win32") forceTimer = setTimeout(() => killTree(true), 1000);
      closeDeadline = setTimeout(() => {
        child.stdout?.destroy(); child.stderr?.destroy(); child.unref(); finish(null);
      }, 5500);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      stopChild();
    }, timeoutMs);

    const appendBounded = (current: string, chunk: Buffer): string => {
      const next = current + chunk.toString();
      if (Buffer.byteLength(next, "utf8") > MAX_OUTPUT_BYTES) {
        killedByOutputCap = true;
        stopChild();
      }
      return next;
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      if (settled || cancelled) return;
      stdout = appendBounded(stdout, chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (settled || cancelled) return;
      stderr = appendBounded(stderr, chunk);
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(forceTimer); clearTimeout(closeDeadline);
      signal?.removeEventListener("abort", onAbort);
      resolve({ ok: false, error: cancelled ? "Runtime cancelled." : `Failed to start runtime: ${err.message}` });
    });

    const finish = (exitCode: number | null) => {
      if (settled) return;
      if ((cancelled || timedOut || killedByOutputCap) && process.platform !== "win32") killTree(true);
      settled = true;
      clearTimeout(timer);
      clearTimeout(forceTimer); clearTimeout(closeDeadline);
      signal?.removeEventListener("abort", onAbort);
      const elapsedMs = Date.now() - startedAt;
      const out = trimOutput(stdout);
      const err = trimOutput(stderr);
      const envelope = {
        runtime: command,
        exit_code: exitCode ?? -1,
        elapsed_ms: elapsedMs,
        timed_out: timedOut,
        cancelled,
        output_capped: killedByOutputCap || out.truncated || err.truncated,
        stdout: out.text,
        stderr: err.text,
      };
      const serialized = JSON.stringify(envelope, null, 2);
      if (cancelled || timedOut) {
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
    };
    child.on("close", finish);
    const onAbort = () => {
      if (settled || cancelled) return;
      cancelled = true;
      clearTimeout(timer);
      stopChild();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

export const executeCodeTool = defineTool({
  name: "execute_code",
  description:
    "WHAT: Execute short Python or JavaScript snippets and return structured stdout/stderr JSON.\n" +
    "WHEN: Numeric calculations, simulation snippets, quick data transforms, binary/header inspection and file metadata (including Python os.path/os.stat).\n" +
    "NOT WHEN: You need package installs, process orchestration, or broader shell access (use run_shell/run_background).\n" +
    "Requires user approval.\n" +
    "ARGS: code, optional language (python by default; javascript must be explicit), optional timeout_ms, optional cwd (workspace-relative).",
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
        description: "Runtime language, default python. Use javascript explicitly for Node.js snippets.",
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
    required: ["code"],
    additionalProperties: false,
  },
  handler: async (args, emit, _harness, context) => {
    if (context?.signal?.aborted) return { ok: false, error: "Runtime cancelled before execution." };
    const language = (args["language"] ?? "python") as "python" | "javascript";
    const code = String(args["code"] ?? "");
    const preview = code.trim().split("\n")[0]?.slice(0, 60) ?? "";
    emit?.(`\nexecute_code (${language}): ${preview}…\n`);
    const timeoutMs = Math.min(
      MAX_TIMEOUT_MS,
      Math.max(1, Number(args["timeout_ms"] ?? DEFAULT_TIMEOUT_MS))
    );
    const cwd = resolveCwd(args["cwd"] as string | undefined);

    if (language === "javascript") {
      return executeSnippet("node", ["-e", code], cwd, timeoutMs, context?.signal);
    }
    if (process.platform === "win32") {
      const pyLauncher = await executeSnippet("py", ["-3", "-c", code], cwd, timeoutMs, context?.signal);
      if (pyLauncher.ok || !/Failed to start runtime/i.test(pyLauncher.error)) {
        return pyLauncher;
      }
    }
    return executeSnippet("python", ["-c", code], cwd, timeoutMs, context?.signal);
  },
});
