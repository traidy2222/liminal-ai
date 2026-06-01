/**
 * run_shell — execute a shell command with live streaming output.
 *
 * Uses spawn() so stdout/stderr stream in real time via text delta events,
 * rather than being fully buffered until completion.
 * Requires user approval when configured (dangerLevel: "destructive").
 */
import { spawn } from "node:child_process";
import type { AgentEmitter } from "@liminal/core";
import { effectiveHarnessEnvRaw, resolveShellRuntime } from "@liminal/core";
import { defineTool } from "./helpers.js";
import { resolveWithinWorkspace } from "./file_path_guard.js";

function parseEnvMs(key: string, fallback: number): number {
  const raw = effectiveHarnessEnvRaw(key)?.trim();
  if (raw === "0") return 0;
  const n = parseInt(raw ?? String(fallback), 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export type ShellTimeoutResolution = {
  timeoutMs: number;
  cappedNote: string;
};

/**
 * - No timeout_ms: default (AGENT_SHELL_TIMEOUT_MS), capped by AGENT_SHELL_IMPLICIT_MAX_MS.
 * - Explicit timeout_ms: honored up to AGENT_SHELL_MAX_TIMEOUT_MS (0 = unlimited).
 */
export function resolveShellTimeoutMs(requested?: number): ShellTimeoutResolution {
  const defaultMs = parseEnvMs("AGENT_SHELL_TIMEOUT_MS", 60_000);
  const explicitMaxMs = parseEnvMs("AGENT_SHELL_MAX_TIMEOUT_MS", 3_600_000);
  const implicitMaxMs = parseEnvMs("AGENT_SHELL_IMPLICIT_MAX_MS", 180_000);
  const floor = 1_000;

  if (requested === undefined) {
    let timeoutMs = defaultMs;
    if (implicitMaxMs > 0) {
      timeoutMs = Math.min(timeoutMs, implicitMaxMs);
    }
    return {
      timeoutMs: Math.max(timeoutMs, floor),
      cappedNote:
        implicitMaxMs > 0 && defaultMs > implicitMaxMs
          ? `[run_shell] implicit cap ${implicitMaxMs}ms (AGENT_SHELL_IMPLICIT_MAX_MS); pass timeout_ms for longer bounded runs.\n`
          : "",
    };
  }

  let timeoutMs = requested;
  let cappedNote = "";
  if (explicitMaxMs > 0 && timeoutMs > explicitMaxMs) {
    timeoutMs = explicitMaxMs;
    cappedNote = `[run_shell] timeout_ms ${requested} capped to ${explicitMaxMs}ms (AGENT_SHELL_MAX_TIMEOUT_MS). Set AGENT_SHELL_MAX_TIMEOUT_MS=0 for no cap.\n`;
  }

  return { timeoutMs: Math.max(timeoutMs, floor), cappedNote };
}

/** Create the run_shell tool with live output streaming via the emitter. */
export function createRunShellTool(emitter: AgentEmitter) {
  return defineTool({
    name: "run_shell",
    description:
      "WHAT: Execute a shell command and return its stdout and stderr. Output streams live while running. Requires user approval.\n" +
      "WHEN: Installing packages, running build/test scripts, or any system task with no dedicated tool.\n" +
      "NOT WHEN: A dedicated tool already covers the task (read_file, edit_file, list_dir, web_fetch, web_search, git_*).\n" +
      "NOT WHEN: A process runs indefinitely (dev server, watcher) — use run_background; poll with read_process_output.\n" +
      "LONG RUNS: Pass timeout_ms for builds/tests that need many minutes or hours (subject to AGENT_SHELL_MAX_TIMEOUT_MS). " +
      "Omitting timeout_ms uses a short default (~60s, implicit max ~3m).\n" +
      "WINDOWS NOTE: The shell is PowerShell. 'curl' is an alias for Invoke-WebRequest — NEVER use curl -L -o flags. " +
      "To download a file: Invoke-WebRequest -Uri 'URL' -OutFile 'file.ext'. " +
      "To run curl proper: use 'curl.exe' (available separately). Pipeline chains use ; not &&.\n" +
      "ARGS: command — shell command string; cwd — optional working directory; timeout_ms — ms limit.",
    requiresApproval: true,
    dangerLevel: "destructive",
    resourceLocks: (args) => {
      const cwd = (args["cwd"] as string | undefined) ?? process.cwd();
      return [`shell:${cwd}`];
    },
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to run" },
        cwd: { type: "string", description: "Working directory (optional)" },
        timeout_ms: {
          type: "number",
          description:
            "Wall-clock limit in ms. Omitted → short default (~60s). Long builds/tests → set explicitly (e.g. 7200000 for 2h). Max: AGENT_SHELL_MAX_TIMEOUT_MS (0 = unlimited).",
        },
        timeout: {
          type: "number",
          description: "Alias for timeout_ms.",
        },
      },
      required: ["command"],
      additionalProperties: false,
    },
    handler: async (args) => {
      const command = args["command"] as string;
      const cwdArg = args["cwd"] as string | undefined;
      let cwd: string | undefined;
      if (cwdArg) {
        const guard = resolveWithinWorkspace(cwdArg);
        if (!guard.ok) {
          return { ok: false, error: guard.error ?? "cwd must stay inside the workspace root." };
        }
        cwd = guard.resolvedPath;
      }
      const requested =
        (args["timeout_ms"] as number | undefined) ?? (args["timeout"] as number | undefined);
      const { timeoutMs: timeout, cappedNote } = resolveShellTimeoutMs(requested);
      const limitLabel =
        timeout >= 3_600_000 ? `${Math.round(timeout / 3_600_000)}h` : `${Math.round(timeout / 1000)}s`;

      return new Promise<import("@liminal/core").ToolResult>((resolve) => {
        const runtime = resolveShellRuntime();
        const shellArgs = [runtime.executable, [...runtime.args, command]];

        const child = spawn(shellArgs[0] as string, shellArgs[1] as string[], {
          cwd,
          shell: false,
          stdio: "pipe",
        });

        const chunks: string[] = [];
        let timedOut = false;
        let headerEmitted = false;
        const startedAt = Date.now();

        const emitDelta = (text: string) => {
          if (!headerEmitted) {
            headerEmitted = true;
            emitter.emit("text", { delta: `\n\`${command}\`\n`, channel: "trace" });
          }
          emitter.emit("text", { delta: text, channel: "trace" });
          chunks.push(text);
        };

        const killTimer = setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
        }, timeout);

        const heartbeatMs = 15_000;
        const heartbeat = setInterval(() => {
          const elapsed = Math.round((Date.now() - startedAt) / 1000);
          emitter.emit("text", {
            delta: `[run_shell] still running (${elapsed}s, limit ${limitLabel})…\n`,
            channel: "trace",
          });
        }, heartbeatMs);

        child.stdout?.on("data", (data: Buffer) => emitDelta(data.toString()));
        child.stderr?.on("data", (data: Buffer) => emitDelta(data.toString()));

        child.on("close", (code) => {
          clearTimeout(killTimer);
          clearInterval(heartbeat);
          const body = chunks.join("").trimEnd() || "(no output)";
          const output = cappedNote + body;
          if (timedOut) {
            resolve({
              ok: false,
              error:
                `Command timed out after ${timeout}ms (${limitLabel}). ` +
                `For longer work pass a higher timeout_ms, or use run_background for daemons.\n` +
                `Output so far:\n${output}`,
            });
          } else if (code !== 0) {
            // Windows diagnostics (nslookup, curl -v) often exit non-zero while still printing signal.
            if (body.length >= 120) {
              resolve({
                ok: true,
                output: `[exit ${code ?? "null"} — output captured; treat as diagnostic, not necessarily total failure]\n${output}`,
              });
            } else {
              resolve({ ok: false, error: `Exit code ${code ?? "null"}.\n${output}` });
            }
          } else {
            resolve({ ok: true, output });
          }
        });

        child.on("error", (err) => {
          clearTimeout(killTimer);
          clearInterval(heartbeat);
          resolve({ ok: false, error: `Failed to spawn: ${err.message}` });
        });
      });
    },
  });
}

/**
 * Non-streaming singleton for backward compatibility and eval scenarios
 * where an emitter is not available.
 */
export const runShellTool = createRunShellTool({
  emit: () => false,
  on: () => ({ off: () => {} }) as never,
  off: () => {},
  once: () => ({ off: () => {} }) as never,
  removeAllListeners: () => {},
} as unknown as AgentEmitter);
