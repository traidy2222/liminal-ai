import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { defineTool } from "./helpers.js";
import { resolveShellRuntime } from "@liminal/core";

interface SessionRecord {
  id: string;
  process: ChildProcessWithoutNullStreams;
  command: string;
  cwd?: string;
  startedAt: number;
  output: string;
  alive: boolean;
  exitCode: number | null;
}

const sessions = new Map<string, SessionRecord>();

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function nowId(): string {
  return `pty_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export const runCommandWithPtyTool = defineTool({
  name: "run_command_with_pty",
  description:
    "WHAT: Manage an interactive shell command session (start/send/read/stop/list) using stdin/stdout streaming.\n" +
    "WHEN: A command needs iterative input/output interaction across multiple turns.\n" +
    "NOT WHEN: One-shot command is enough; use run_shell for simple non-interactive commands.\n" +
    "ARGS: action plus session_id/command/cwd/input/tail_chars as needed.",
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
        description: "Session id returned from start action.",
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
  handler: async (args) => {
    const action = String(args["action"] ?? "").toLowerCase();

    if (action === "list") {
      if (sessions.size === 0) return { ok: true, output: "(no active PTY sessions)" };
      const rows = [...sessions.values()].map((s) => {
        const ageSec = Math.round((Date.now() - s.startedAt) / 1000);
        const status = s.alive ? "running" : `exited(${s.exitCode ?? "?"})`;
        return `${s.id} [${status}] ${ageSec}s  ${s.command.slice(0, 80)}`;
      });
      return { ok: true, output: rows.join("\n") };
    }

    if (action === "start") {
      const command = String(args["command"] ?? "").trim();
      const cwd = (args["cwd"] as string | undefined)?.trim();
      if (!command) return { ok: false, error: "start requires command." };
      const runtime = resolveShellRuntime();
      try {
        const proc = spawn(runtime.executable, [...runtime.args, command], {
          shell: false,
          cwd,
          stdio: "pipe",
          windowsHide: true,
        });
        const child = proc as ChildProcessWithoutNullStreams;
        const id = nowId();
        const rec: SessionRecord = {
          id,
          process: child,
          command,
          cwd,
          startedAt: Date.now(),
          output: "",
          alive: true,
          exitCode: null,
        };
        child.stdout.on("data", (buf: Buffer) => {
          rec.output += buf.toString();
          if (rec.output.length > 12000) rec.output = rec.output.slice(-12000);
        });
        child.stderr.on("data", (buf: Buffer) => {
          rec.output += buf.toString();
          if (rec.output.length > 12000) rec.output = rec.output.slice(-12000);
        });
        child.on("exit", (code) => {
          rec.alive = false;
          rec.exitCode = code;
        });
        sessions.set(id, rec);
        return {
          ok: true,
          output: `Started PTY session ${id} (${runtime.displayName})\nCommand: ${command}\nUse send/read/stop with session_id.`,
        };
      } catch (err) {
        return { ok: false, error: `Failed to start command: ${err instanceof Error ? err.message : String(err)}` };
      }
    }

    const sessionId = String(args["session_id"] ?? "").trim();
    if (!sessionId) return { ok: false, error: `${action} requires session_id.` };
    const rec = sessions.get(sessionId);
    if (!rec) return { ok: false, error: `Unknown session_id: ${sessionId}` };

    if (action === "send") {
      if (!rec.alive) return { ok: false, error: `Session ${sessionId} is not running.` };
      const input = String(args["input"] ?? "");
      const appendNewline = args["append_newline"] !== false;
      rec.process.stdin.write(appendNewline ? `${input}\n` : input, "utf8");
      return { ok: true, output: `Sent ${input.length} chars to ${sessionId}.` };
    }

    if (action === "read") {
      const tailChars = clampInt(Number(args["tail_chars"] ?? 2000), 100, 12000);
      const tail = rec.output.slice(-tailChars).trim();
      const status = rec.alive ? "running" : `exited (${rec.exitCode ?? "?"})`;
      return { ok: true, output: `Session ${sessionId} [${status}]\n${tail || "(no output yet)"}` };
    }

    if (action === "stop") {
      if (rec.alive) {
        rec.process.kill("SIGTERM");
      }
      sessions.delete(sessionId);
      return { ok: true, output: `Stopped session ${sessionId}.` };
    }

    return { ok: false, error: `Unsupported action: ${action}` };
  },
});
