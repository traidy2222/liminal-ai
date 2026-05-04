import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { defineTool } from "./helpers.js";

// ─── Shared process registry ──────────────────────────────────────────────────

interface ProcessRecord {
  pid: number;
  command: string;
  cwd?: string;
  process: ChildProcess;
  startedAt: number;
  outputBuffer: string;
  exitCode: number | null;
  alive: boolean;
}

const registry = new Map<number, ProcessRecord>();

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

// ─── Tools ────────────────────────────────────────────────────────────────────

export const runBackgroundTool = defineTool({
  name: "run_background",
  description:
    "WHAT: Start a long-running process (server, watcher, daemon) in the background and return its PID immediately.\n" +
    "WHEN: Starting a dev server, HTTP server, or any process that runs indefinitely and doesn't exit on its own.\n" +
    "NOT WHEN: Running a command that completes (build, test, install) — use run_shell for those.\n" +
    "ARGS: command — shell command to run; cwd — working directory (ALWAYS provide this); " +
    "startup_wait_ms — ms to wait before returning so startup output is captured (default: 2000).",
  requiresApproval: true,
  dangerLevel: "destructive",
  resourceLocks: (args) => {
    const cwd = (args["cwd"] as string | undefined) ?? "cwd";
    return [`shell:${cwd}`];
  },
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "Command to run in background" },
      cwd: { type: "string", description: "Working directory — always provide this" },
      startup_wait_ms: {
        type: "number",
        description: "Wait this many ms after launch before returning (default: 2000)",
      },
    },
    required: ["command"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const command = args["command"] as string;
    const cwd = args["cwd"] as string | undefined;
    const startupWait = (args["startup_wait_ms"] as number | undefined) ?? 2000;

    try {
      const child = spawn(command, {
        shell: true,
        cwd,
        detached: false,
        stdio: ["ignore", "pipe", "pipe"],
      });

      if (!child.pid) {
        return { ok: false, error: "Failed to spawn process — no PID assigned" };
      }

      const pid = child.pid;
      const record: ProcessRecord = {
        pid,
        command,
        cwd,
        process: child,
        startedAt: Date.now(),
        outputBuffer: "",
        exitCode: null,
        alive: true,
      };

      child.stdout?.on("data", (d: Buffer) => {
        record.outputBuffer += d.toString();
        // Keep last 10 KB to avoid unbounded growth
        if (record.outputBuffer.length > 10_240) {
          record.outputBuffer = record.outputBuffer.slice(-10_240);
        }
      });
      child.stderr?.on("data", (d: Buffer) => {
        record.outputBuffer += d.toString();
        if (record.outputBuffer.length > 10_240) {
          record.outputBuffer = record.outputBuffer.slice(-10_240);
        }
      });
      child.on("exit", (code) => {
        record.exitCode = code;
        record.alive = false;
      });

      registry.set(pid, record);

      // Wait for startup so we can capture initial output / crash messages
      await sleep(startupWait);

      const initial = record.outputBuffer.slice(0, 800).trim();
      const status = record.alive ? "running" : `exited (code ${record.exitCode})`;

      if (!record.alive && record.exitCode !== 0) {
        registry.delete(pid);
        return {
          ok: false,
          error:
            `Process exited immediately with code ${record.exitCode}.\n` +
            `Output: ${initial || "(none)"}`,
        };
      }

      return {
        ok: true,
        output:
          `PID: ${pid} | Status: ${status} | CWD: ${cwd ?? "inherited"}\n` +
          `Initial output:\n${initial || "(none yet — may still be starting)"}`,
      };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  },
});

export const killProcessTool = defineTool({
  name: "kill_process",
  description:
    "WHAT: Stop a background process by PID and free its resources.\n" +
    "WHEN: After you're done with a server, or before restarting it, or to clean up after a task.\n" +
    "NOT WHEN: The process has already exited — check list_processes first if unsure.\n" +
    "ARGS: pid — process ID from run_background; signal — optional kill signal (default: SIGTERM).",
  requiresApproval: true,
  dangerLevel: "cautious",
  parameters: {
    type: "object",
    properties: {
      pid: { type: "number", description: "Process ID to kill" },
      signal: { type: "string", description: "Kill signal: SIGTERM (graceful) or SIGKILL (force). Default: SIGTERM" },
    },
    required: ["pid"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const pid = args["pid"] as number;
    const signal = (args["signal"] as NodeJS.Signals | undefined) ?? "SIGTERM";
    const record = registry.get(pid);

    if (!record) {
      return {
        ok: false,
        error: `No tracked process with PID ${pid}. Use list_processes to see active processes.`,
      };
    }

    if (!record.alive) {
      registry.delete(pid);
      return {
        ok: true,
        output: `Process ${pid} had already exited (code ${record.exitCode}).`,
      };
    }

    try {
      record.process.kill(signal);
      registry.delete(pid);
      return { ok: true, output: `Sent ${signal} to PID ${pid} (${record.command.slice(0, 60)})` };
    } catch (err) {
      return { ok: false, error: `Failed to kill PID ${pid}: ${String(err)}` };
    }
  },
});

export const listProcessesTool = defineTool({
  name: "list_processes",
  description:
    "WHAT: List all background processes started with run_background, with their PID, status, and uptime.\n" +
    "WHEN: Before starting a server (to check for port conflicts), after a task (to find processes to kill), or to get a PID you forgot.\n" +
    "NOT WHEN: You just started a process and already have its PID — no need to list.\n" +
    "ARGS: none.",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  handler: async (_args) => {
    if (registry.size === 0) {
      return { ok: true, output: "(no background processes tracked)" };
    }

    const lines = [...registry.values()].map((p) => {
      const age = Math.round((Date.now() - p.startedAt) / 1000);
      const status = p.alive ? "running" : `exited(${p.exitCode})`;
      return `PID ${p.pid} [${status}] ${age}s — ${p.command.slice(0, 70)}${p.cwd ? ` (cwd: ${p.cwd})` : ""}`;
    });

    return { ok: true, output: lines.join("\n") };
  },
});

export const readProcessOutputTool = defineTool({
  name: "read_process_output",
  description:
    "WHAT: Read the buffered stdout/stderr from a running background process.\n" +
    "WHEN: After starting a server and waiting a moment, to verify it started correctly or check for errors.\n" +
    "NOT WHEN: The process just started — wait at least startup_wait_ms seconds first.\n" +
    "ARGS: pid — process ID from run_background; tail_chars — how many chars to return from end of output (default: 1000).",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      pid: { type: "number", description: "Process ID to read output from" },
      tail_chars: { type: "number", description: "Characters to return from end (default: 1000)" },
    },
    required: ["pid"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const pid = args["pid"] as number;
    const tail = (args["tail_chars"] as number | undefined) ?? 1000;
    const record = registry.get(pid);

    if (!record) {
      return {
        ok: false,
        error: `No tracked process with PID ${pid}. Use list_processes to see active processes.`,
      };
    }

    const output = record.outputBuffer.slice(-tail).trim();
    const status = record.alive
      ? "running"
      : `exited (code ${record.exitCode})`;

    return {
      ok: true,
      output: `PID ${pid} [${status}]\n${output || "(no output yet)"}`,
    };
  },
});
