import type { AgentHarness, ToolResult } from "@liminal/core";
import { defineTool } from "../../shared/helpers.js";
import {
  getTerminalBackgroundJob,
  killTerminalSession,
  listTerminalBackgroundJobs,
  readTerminalOutput,
  runBackgroundInTerminal,
  shellUseUiPty,
  terminalPtyRead,
  terminalPtySend,
} from "./terminal_shell_runtime.js";
import { getPtyShellPort } from "./pty_shell_port.js";
import { ensureChatTerminal } from "./terminal_runtime.js";

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

/**
 * Interactive terminal session control — backed by the visible UI PTY when available.
 * @deprecated Prefer run_shell / run_background + read_process_output with session_id.
 */
export const runCommandWithPtyTool = defineTool({
  name: "run_command_with_pty",
  description:
    "WHAT: Manage an interactive command in a visible Terminal tab (start/send/read/stop/list).\n" +
    "WHEN: A command needs iterative input/output across multiple turns in the same shell.\n" +
    "NOT WHEN: One-shot command — use run_shell. Long-running server — use run_background.\n" +
    "ARGS: action plus session_id/command/cwd/input/tail_chars as needed. session_id is the Terminal tab id.",
  requiresApproval: true,
  dangerLevel: "destructive",
  resourceLocks: (args) => {
    const action = String(args["action"] ?? "start").toLowerCase();
    if (action === "start") {
      const cwd = (args["cwd"] as string | undefined) ?? "cwd";
      return [`shell:${cwd}`];
    }
    const sessionId = String(args["session_id"] ?? "").trim();
    return sessionId ? [`shell:pty:${sessionId}`] : ["shell:pty:global"];
  },
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["start", "send", "read", "stop", "list"],
      },
      session_id: {
        type: "string",
        description: "Terminal session id (from start or run_background).",
      },
      command: {
        type: "string",
        description: "Command to run (required for start).",
      },
      cwd: {
        type: "string",
        description: "Working directory for start action.",
      },
      input: {
        type: "string",
        description: "Input to send for send action.",
      },
      append_newline: {
        type: "boolean",
        description: "Append newline to input (default true).",
      },
      tail_chars: {
        type: "number",
        description: "Chars of output tail to read (default 2000, max 12000).",
      },
    },
    required: ["action"],
    additionalProperties: false,
  },
  handler: async (args) => runCommandWithPtyHandler(args),
});

async function runCommandWithPtyHandler(
  args: Record<string, unknown>,
  harness?: AgentHarness
): Promise<ToolResult> {
  const action = String(args["action"] ?? "").toLowerCase();
  const port = getPtyShellPort();

  if (action === "list") {
    const jobs = listTerminalBackgroundJobs(harness?.taskId);
    const portSessions = port && harness?.taskId ? port.list(harness.taskId) : [];
    if (jobs.length === 0 && portSessions.length === 0) {
      return { ok: true, output: "(no active terminal sessions)" };
    }
    const rows = [
      ...jobs.map((j) => {
        const alive = port?.isAlive(j.sessionId) ?? false;
        const ageSec = Math.round((Date.now() - j.startedAt) / 1000);
        return `${j.sessionId} [${alive ? "running" : "exited"}] ${ageSec}s  ${j.command.slice(0, 80)}`;
      }),
      ...portSessions
        .filter((s) => !jobs.some((j) => j.sessionId === s.sessionId))
        .map((s) => `${s.sessionId} [tab] ${s.label}`),
    ];
    return { ok: true, output: rows.join("\n") };
  }

  if (!port) {
    return { ok: false, error: "Terminal PTY runtime is not available." };
  }

  if (action === "start") {
    const command = String(args["command"] ?? "").trim();
    const cwd = (args["cwd"] as string | undefined)?.trim();
    if (!command) return { ok: false, error: "start requires command." };
    if (harness && shellUseUiPty(harness.getRuntimePreferences())) {
      return runBackgroundInTerminal({
        harness,
        command,
        cwd: cwd || undefined,
        startupWaitMs: 500,
      });
    }
    const chatId = harness?.taskId?.trim();
    if (!chatId) {
      return { ok: false, error: "start requires an active chat harness." };
    }
    const opened = await ensureChatTerminal({
      chatId,
      label: command.slice(0, 48),
      source: "agent",
      forceNew: true,
      cwd: cwd || undefined,
      focus: true,
    });
    if (!opened) {
      return { ok: false, error: "Failed to open terminal session." };
    }
    const eol = process.platform === "win32" ? "\r\n" : "\n";
    const cd =
      cwd && process.platform !== "win32"
        ? `cd '${cwd.replace(/'/g, "'\\''")}' && `
        : "";
    port.write(opened.sessionId, `${cd}${command}${eol}`);
    return {
      ok: true,
      output: `Started terminal session ${opened.sessionId}\nCommand: ${command}\nUse send/read/stop with session_id.`,
    };
  }

  const sessionId = String(args["session_id"] ?? "").trim();
  if (!sessionId) return { ok: false, error: `${action} requires session_id.` };

  if (action === "send") {
    const input = String(args["input"] ?? "");
    const appendNewline = args["append_newline"] !== false;
    return terminalPtySend(sessionId, input, appendNewline);
  }

  if (action === "read") {
    const tailChars = clampInt(Number(args["tail_chars"] ?? 2000), 100, 12000);
    const job = getTerminalBackgroundJob(sessionId);
    if (job) {
      return readTerminalOutput(sessionId, tailChars);
    }
    return terminalPtyRead(sessionId, tailChars);
  }

  if (action === "stop") {
    return killTerminalSession(sessionId);
  }

  return { ok: false, error: `Unsupported action: ${action}` };
}

/** Harness-scoped variant with chat context for start/list. */
export function createRunCommandWithPtyTool(harness: AgentHarness) {
  return defineTool({
    ...runCommandWithPtyTool,
    handler: async (args) => runCommandWithPtyHandler(args, harness),
  });
}
