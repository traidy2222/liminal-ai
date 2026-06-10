import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import type { AgentHarness, ToolResult } from "@liminal/core";
import { resolveShellRuntime, effectiveHarnessEnvRaw } from "@liminal/core";
import { defineTool } from "../../shared/helpers.js";
import {
  killTerminalSession,
  listTerminalJobsForChat,
  readTerminalOutput,
  runBackgroundInTerminal,
  shellUseUiPty,
} from "./terminal_shell_runtime.js";

// ─── Legacy spawn registry (eval / headless fallback) ─────────────────────────

interface ProcessRecord {
  pid: number;
  command: string;
  cwd?: string;
  process: ChildProcess;
  startedAt: number;
  outputBuffer: string;
  exitCode: number | null;
  alive: boolean;
  shell: string;
}

const legacyRegistry = new Map<number, ProcessRecord>();

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function resolveSessionOrPid(args: Record<string, unknown>): {
  sessionId?: string;
  pid?: number;
} {
  const sessionId = String(args["session_id"] ?? "").trim();
  const pid = args["pid"] as number | undefined;
  if (sessionId) return { sessionId };
  if (typeof pid === "number" && Number.isFinite(pid)) return { pid };
  return {};
}

// ─── Legacy spawn tools (no harness / PTY unavailable) ────────────────────────

export const runBackgroundTool = defineTool({
  name: "run_background",
  description:
    "WHAT: Start a long-running process (server, watcher, daemon) in a dedicated Terminal tab and return its session_id immediately.\n" +
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
  handler: async (args) => runBackgroundSpawn(args),
});

async function runBackgroundSpawn(args: Record<string, unknown>): Promise<ToolResult> {
  const command = args["command"] as string;
  const cwd = args["cwd"] as string | undefined;
  const startupWait = (args["startup_wait_ms"] as number | undefined) ?? 2000;

  try {
    const runtime = resolveShellRuntime();
    const child = spawn(runtime.executable, [...runtime.args, command], {
      shell: false,
      cwd,
      detached: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
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
      shell: runtime.displayName,
    };

    child.stdout?.on("data", (d: Buffer) => {
      record.outputBuffer += d.toString();
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

    legacyRegistry.set(pid, record);
    await sleep(startupWait);

    const initial = record.outputBuffer.slice(0, 800).trim();
    const status = record.alive ? "running" : `exited (code ${record.exitCode})`;

    if (!record.alive && record.exitCode !== 0) {
      legacyRegistry.delete(pid);
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
        `PID: ${pid} | Status: ${status} | Shell: ${record.shell} | CWD: ${cwd ?? "inherited"}\n` +
        `[headless fallback — no Terminal UI]\n` +
        `Initial output:\n${initial || "(none yet — may still be starting)"}`,
    };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export const killProcessTool = defineTool({
  name: "kill_process",
  description:
    "WHAT: Stop a background process by session_id (Terminal tab) or legacy PID.\n" +
    "WHEN: After you're done with a server, or before restarting it, or to clean up after a task.\n" +
    "ARGS: session_id — from run_background (preferred); pid — legacy headless fallback only.",
  requiresApproval: true,
  dangerLevel: "cautious",
  parameters: {
    type: "object",
    properties: {
      session_id: { type: "string", description: "Terminal session id from run_background" },
      pid: { type: "number", description: "Legacy PID (headless fallback only)" },
      signal: { type: "string", description: "Kill signal for legacy PID mode (default: SIGTERM)" },
    },
    additionalProperties: false,
  },
  handler: async (args) => killProcessHandler(args),
});

async function killProcessHandler(args: Record<string, unknown>): Promise<ToolResult> {
  const { sessionId, pid } = resolveSessionOrPid(args);
  if (sessionId) {
    return killTerminalSession(sessionId);
  }
  if (pid == null) {
    return { ok: false, error: "session_id or pid required." };
  }

  const signal = (args["signal"] as NodeJS.Signals | undefined) ?? "SIGTERM";
  const record = legacyRegistry.get(pid);

  if (!record) {
    return {
      ok: false,
      error: `No tracked process with PID ${pid}. Use list_processes or session_id from run_background.`,
    };
  }

  if (!record.alive) {
    legacyRegistry.delete(pid);
    return {
      ok: true,
      output: `Process ${pid} had already exited (code ${record.exitCode}).`,
    };
  }

  try {
    record.process.kill(signal);
    legacyRegistry.delete(pid);
    return { ok: true, output: `Sent ${signal} to PID ${pid} (${record.command.slice(0, 60)})` };
  } catch (err) {
    if (process.platform === "win32") {
      try {
        const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
          shell: false,
          stdio: "ignore",
          windowsHide: true,
        });
        await new Promise<void>((resolve) => killer.on("close", () => resolve()));
        legacyRegistry.delete(pid);
        return { ok: true, output: `Forced termination via taskkill for PID ${pid}` };
      } catch {
        /* fall through */
      }
    }
    return { ok: false, error: `Failed to kill PID ${pid}: ${String(err)}` };
  }
}

export const listProcessesTool = defineTool({
  name: "list_processes",
  description:
    "WHAT: List background terminal sessions (session_id) started with run_background.\n" +
    "WHEN: Before starting a server (port conflicts), after a task, or to recover a session_id.\n" +
    "ARGS: none.",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  handler: async (_args) => listProcessesHandler(),
});

function listProcessesHandler(chatId?: string): ToolResult {
  const terminalList = chatId ? listTerminalJobsForChat(chatId) : listTerminalJobsForChat("");
  if (legacyRegistry.size === 0 && terminalList.ok) {
    return terminalList;
  }

  const lines: string[] = [];
  if (terminalList.ok && terminalList.output && !terminalList.output.startsWith("(no")) {
    lines.push(terminalList.output);
  }
  if (legacyRegistry.size > 0) {
    for (const p of legacyRegistry.values()) {
      const age = Math.round((Date.now() - p.startedAt) / 1000);
      const status = p.alive ? "running" : `exited(${p.exitCode})`;
      lines.push(
        `PID ${p.pid} [${status}] ${age}s — ${p.command.slice(0, 70)}${p.cwd ? ` (cwd: ${p.cwd})` : ""} [headless]`
      );
    }
  }
  if (lines.length === 0) {
    return { ok: true, output: "(no background processes tracked)" };
  }
  return { ok: true, output: lines.join("\n") };
}

export const readProcessOutputTool = defineTool({
  name: "read_process_output",
  description:
    "WHAT: Read output from a background terminal session (session_id) or legacy PID.\n" +
    "WHEN: After run_background, to verify startup or check for errors.\n" +
    "ARGS: session_id — preferred; pid — legacy headless; tail_chars — tail size (default 1000).",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      session_id: { type: "string", description: "Terminal session id from run_background" },
      pid: { type: "number", description: "Legacy PID (headless fallback)" },
      tail_chars: { type: "number", description: "Characters to return from end (default: 1000)" },
      health_url: {
        type: "string",
        description:
          "When AGENT_PROCESS_HEALTH=1, optional URL to GET once and append status line",
      },
    },
    additionalProperties: false,
  },
  handler: async (args) => readProcessOutputHandler(args),
});

async function readProcessOutputHandler(args: Record<string, unknown>): Promise<ToolResult> {
  const { sessionId, pid } = resolveSessionOrPid(args);
  const tail = (args["tail_chars"] as number | undefined) ?? 1000;
  const healthUrl = (args["health_url"] as string | undefined)?.trim();

  if (sessionId) {
    return readTerminalOutput(sessionId, tail, healthUrl);
  }
  if (pid == null) {
    return { ok: false, error: "session_id or pid required." };
  }

  const record = legacyRegistry.get(pid);
  if (!record) {
    return {
      ok: false,
      error: `No tracked process with PID ${pid}. Use list_processes.`,
    };
  }

  const output = record.outputBuffer.slice(-tail).trim();
  const status = record.alive ? "running" : `exited (code ${record.exitCode})`;

  let healthLine = "";
  if (effectiveHarnessEnvRaw("AGENT_PROCESS_HEALTH") === "1" && healthUrl) {
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 3_000);
      const r = await fetch(healthUrl, { method: "GET", signal: ac.signal });
      clearTimeout(t);
      healthLine = `\nHealth probe: GET ${healthUrl} → HTTP ${r.status}`;
    } catch (e) {
      healthLine = `\nHealth probe: GET ${healthUrl} → failed (${String(e).slice(0, 120)})`;
    }
  }

  return {
    ok: true,
    output: `PID ${pid} [${status}]\n${output || "(no output yet)"}${healthLine}`,
  };
}

// ─── Harness-scoped tools (prefer visible Terminal PTY) ─────────────────────

export function createRunBackgroundTool(harness: AgentHarness) {
  return defineTool({
    ...runBackgroundTool,
    handler: async (args) => {
      const prefs = harness.getRuntimePreferences();
      if (shellUseUiPty(prefs)) {
        const command = args["command"] as string;
        const cwd = args["cwd"] as string | undefined;
        const startupWait = (args["startup_wait_ms"] as number | undefined) ?? 2000;
        return runBackgroundInTerminal({ harness, command, cwd, startupWaitMs: startupWait });
      }
      return runBackgroundSpawn(args);
    },
  });
}

export function createKillProcessTool(harness: AgentHarness) {
  return defineTool({
    ...killProcessTool,
    handler: async (args) => killProcessHandler(args),
  });
}

export function createListProcessesTool(harness: AgentHarness) {
  return defineTool({
    ...listProcessesTool,
    handler: async () => listProcessesHandler(harness.taskId),
  });
}

export function createReadProcessOutputTool(harness: AgentHarness) {
  return defineTool({
    ...readProcessOutputTool,
    handler: async (args) => readProcessOutputHandler(args),
  });
}
