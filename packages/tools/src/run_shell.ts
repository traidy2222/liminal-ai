/**
 * run_shell — execute a shell command with live streaming output.
 *
 * Uses spawn() so stdout/stderr stream in real time via text delta events,
 * rather than being fully buffered until completion.
 * Requires user approval when configured (dangerLevel: "destructive").
 */
import { spawn } from "node:child_process";
import type { AgentEmitter } from "@liminal/core";
import { resolveShellRuntime } from "@liminal/core";
import { defineTool } from "./helpers.js";

/** Create the run_shell tool with live output streaming via the emitter. */
export function createRunShellTool(emitter: AgentEmitter) {
  return defineTool({
    name: "run_shell",
    description:
      "WHAT: Execute a shell command and return its stdout and stderr. Output streams live while running. Requires user approval.\n" +
      "WHEN: Installing packages, running build/test scripts, or any system task with no dedicated tool.\n" +
      "NOT WHEN: A dedicated tool already covers the task (read_file, edit_file, list_dir, web_fetch, web_search, git_*).\n" +
      "NOT WHEN: Starting a server or long-running process — use run_background for those.\n" +
      "WINDOWS NOTE: The shell is PowerShell. 'curl' is an alias for Invoke-WebRequest — NEVER use curl -L -o flags. " +
      "To download a file: Invoke-WebRequest -Uri 'URL' -OutFile 'file.ext'. " +
      "To run curl proper: use 'curl.exe' (available separately). Pipeline chains use ; not &&.\n" +
      "ARGS: command — shell command string; cwd — optional working directory; timeout_ms — ms limit (default 60000).",
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
          description: "Timeout in milliseconds (default: 60000). Also accepted as 'timeout'.",
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
      const cwd = args["cwd"] as string | undefined;
      const timeout = (args["timeout_ms"] as number | undefined) ?? (args["timeout"] as number | undefined) ?? 60_000;

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

        child.stdout?.on("data", (data: Buffer) => emitDelta(data.toString()));
        child.stderr?.on("data", (data: Buffer) => emitDelta(data.toString()));

        child.on("close", (code) => {
          clearTimeout(killTimer);
          const output = chunks.join("").trimEnd() || "(no output)";
          if (timedOut) {
            resolve({
              ok: false,
              error: `Command timed out after ${timeout}ms.\nOutput so far:\n${output}`,
            });
          } else if (code !== 0) {
            resolve({ ok: false, error: `Exit code ${code ?? "null"}.\n${output}` });
          } else {
            resolve({ ok: true, output });
          }
        });

        child.on("error", (err) => {
          clearTimeout(killTimer);
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
