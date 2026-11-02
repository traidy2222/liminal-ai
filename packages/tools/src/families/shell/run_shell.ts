/**
 * run_shell — execute a shell command with live streaming output.
 *
 * When a UI PTY runtime is available (desktop/web), commands run in the visible
 * agent terminal tab. Otherwise falls back to spawn() + pipes.
 */
import { spawn, execFile } from "node:child_process";
import type { AgentEmitter, AgentHarness } from "@liminal/core";
import { effectiveHarnessEnvRaw, resolveShellRuntime, resolveWorkspaceRoot } from "@liminal/core";
import { defineTool } from "../../shared/helpers.js";
import { resolveWithinWorkspace } from "../../shared/file_path_guard.js";
import { runShellInTerminal, shellUseUiPty } from "./terminal_shell_runtime.js";

function parseEnvMs(key: string, fallback: number): number {
  const raw = effectiveHarnessEnvRaw(key)?.trim();
  if (raw === "0") return 0;
  const n = parseInt(raw ?? String(fallback), 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function defaultShellCwd(harness?: AgentHarness): string {
  const fromHarness = harness?.workspaceRoot?.trim();
  return fromHarness || resolveWorkspaceRoot();
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

function runShellSpawn(input: {
  emitter: AgentEmitter;
  command: string;
  cwd?: string;
  timeout: number;
  cappedNote: string;
  limitLabel: string;
}): Promise<import("@liminal/core").ToolResult> {
  const { emitter, command, cwd, timeout, cappedNote, limitLabel } = input;
  return new Promise<import("@liminal/core").ToolResult>((resolve) => {
    const runtime = resolveShellRuntime();
    const shellArgs = [runtime.executable, [...runtime.args, command]];

    const child = spawn(shellArgs[0] as string, shellArgs[1] as string[], {
      cwd,
      shell: false,
      stdio: "pipe",
      detached: process.platform !== "win32",
      windowsHide: true,
    });

    const outputLimit = 256 * 1024;
    let outputTail = "", outputChars = 0, traceChars = 0, traceTruncated = false;
    let timedOut = false;
    let settled = false;
    let forceTimer: ReturnType<typeof setTimeout> | undefined;
    let closeDeadline: ReturnType<typeof setTimeout> | undefined;
    let headerEmitted = false;
    const startedAt = Date.now();

    const emitDelta = (text: string) => {
      if (!headerEmitted) {
        headerEmitted = true;
        emitter.emit("text", { delta: `\n\`${command}\`\n`, channel: "trace" });
      }
      const visible = text.slice(0, Math.max(0, outputLimit - traceChars));
      if (visible) emitter.emit("text", { delta: visible, channel: "trace" });
      traceChars += visible.length;
      if (visible.length < text.length && !traceTruncated) {
        traceTruncated = true;
        emitter.emit("text", { delta: "\n[run_shell] Live output limit reached; final result retains the output tail.\n", channel: "trace" });
      }
      outputChars += text.length;
      outputTail = (outputTail + text).slice(-outputLimit);
    };

    const killTree = (force = false) => {
      if (!child.pid) return;
      if (process.platform === "win32") {
        execFile("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, timeout: 5000 }, error => {
          if (error && !settled) { try { child.kill("SIGKILL"); } catch { /* close deadline still applies */ } }
        });
      } else {
        try { process.kill(-child.pid, force ? "SIGKILL" : "SIGTERM"); }
        catch { try { child.kill(force ? "SIGKILL" : "SIGTERM"); } catch { /* process already exited */ } }
      }
    };

    const killTimer = setTimeout(() => {
      timedOut = true;
      killTree();
      if (process.platform !== "win32") forceTimer = setTimeout(() => killTree(true), 1000);
      closeDeadline = setTimeout(() => {
        child.stdout?.destroy(); child.stderr?.destroy(); child.unref(); finish(null);
      }, 5500);
    }, timeout);

    const heartbeatMs = 15_000;
    const heartbeat = setInterval(() => {
      const elapsed = Math.round((Date.now() - startedAt) / 1000);
      emitter.emit("text", {
        delta: `[run_shell] still running (${elapsed}s, limit ${limitLabel})…\n`,
        channel: "trace",
      });
    }, heartbeatMs);

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (data: string) => emitDelta(data));
    child.stderr?.on("data", (data: string) => emitDelta(data));

    const finish = (code: number | null) => {
      if (settled) return;
      if (timedOut && process.platform !== "win32") killTree(true);
      settled = true;
      clearTimeout(killTimer);
      clearTimeout(forceTimer);
      clearTimeout(closeDeadline);
      clearInterval(heartbeat);
      const body = (outputChars > outputLimit ? "[output truncated — latest characters retained]\n" : "") + (outputTail.trimEnd() || "(no output)");
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
    };
    child.on("close", finish);

    child.on("error", (err) => {
      settled = true;
      clearTimeout(killTimer);
      clearTimeout(forceTimer);
      clearTimeout(closeDeadline);
      clearInterval(heartbeat);
      resolve({ ok: false, error: `Failed to spawn: ${err.message}` });
    });
  });
}

/** Create the run_shell tool with live output streaming via the emitter. */
export function createRunShellTool(emitter: AgentEmitter, harness?: AgentHarness) {
  return defineTool({
    name: "run_shell",
    description:
      "WHAT: Execute a shell command and return its stdout and stderr. Output streams live in the Terminal panel and chat trace. Requires user approval.\n" +
      "UI TERMINAL: One shared Agent shell tab — commands are pasted into that shell stdin (visible in Terminal). NEVER batch multiple run_shell in one turn. Output lives in Terminal; tool result is a summary only.\n" +
      "WHEN: Installing packages, running build/test scripts, or any system task with no dedicated tool.\n" +
      "NOT WHEN: A dedicated tool already covers the task (read_file, edit_file, list_dir, web_fetch, web_search, git_*).\n" +
      "NOT WHEN: A process runs indefinitely (dev server, watcher) — use run_background; poll with read_process_output (session_id).\n" +
      "LONG RUNS: Pass timeout_ms for builds/tests that need many minutes or hours (subject to AGENT_SHELL_MAX_TIMEOUT_MS). " +
      "Omitting timeout_ms uses a short default (~60s, implicit max ~3m).\n" +
      "WINDOWS NOTE: The shell is PowerShell. 'curl' is an alias for Invoke-WebRequest — NEVER use curl -L -o flags. " +
      "To download a file: Invoke-WebRequest -Uri 'URL' -OutFile 'file.ext'. " +
      "To run curl proper: use 'curl.exe' (available separately). Pipeline chains use ; not &&.\n" +
      "ARGS: command — shell command string; cwd — optional working directory; timeout_ms — ms limit.",
    requiresApproval: true,
    dangerLevel: "destructive",
    resourceLocks: (args) => {
      const chatId = harness?.taskId?.trim();
      const prefs = harness?.getRuntimePreferences() ?? null;
      if (chatId && shellUseUiPty(prefs)) {
        return [`shell:terminal:${chatId}`];
      }
      const cwdArg = args["cwd"] as string | undefined;
      if (cwdArg) {
        const guard = resolveWithinWorkspace(cwdArg);
        return [`shell:${guard.ok ? guard.resolvedPath : cwdArg}`];
      }
      return [`shell:${defaultShellCwd(harness)}`];
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
      let cwd: string;
      if (cwdArg) {
        const guard = resolveWithinWorkspace(cwdArg);
        if (!guard.ok) {
          return { ok: false, error: guard.error ?? "cwd must stay inside the workspace root." };
        }
        cwd = guard.resolvedPath ?? defaultShellCwd(harness);
      } else {
        cwd = defaultShellCwd(harness);
      }
      const requested =
        (args["timeout_ms"] as number | undefined) ?? (args["timeout"] as number | undefined);
      const { timeoutMs: timeout, cappedNote } = resolveShellTimeoutMs(requested);
      const limitLabel =
        timeout >= 3_600_000 ? `${Math.round(timeout / 3_600_000)}h` : `${Math.round(timeout / 1000)}s`;

      const prefs = harness?.getRuntimePreferences() ?? null;
      if (harness && shellUseUiPty(prefs)) {
        // Terminal panel is the live view — do not duplicate PTY scrollback into chat trace.
        return runShellInTerminal({
          harness,
          command,
          cwd,
          timeoutMs: timeout,
          cappedNote,
        });
      }

      return runShellSpawn({
        emitter,
        command,
        cwd,
        timeout,
        cappedNote,
        limitLabel,
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
