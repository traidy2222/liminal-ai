import { exec } from "node:child_process";
import { promisify } from "node:util";
import { defineTool } from "./helpers.js";

const execAsync = promisify(exec);

export const runShellTool = defineTool({
  name: "run_shell",
  description:
    "WHAT: Execute an arbitrary shell command and return its stdout and stderr. Requires user approval.\n" +
    "WHEN: Installing packages, running build/test scripts, git operations, or any system task with no dedicated tool.\n" +
    "NOT WHEN: A dedicated tool already covers the task (read_file, write_file, list_dir, web_fetch, web_search).\n" +
    "NOT WHEN: Starting a server or long-running process — use run_background for those.\n" +
    "ARGS: command — shell command string; cwd — optional working directory; timeout_ms — optional ms limit (default 30000).",
  requiresApproval: true,
  dangerLevel: "destructive",
  resourceLocks: (args) => {
    const cwd = (args["cwd"] as string | undefined) ?? "cwd";
    return [`shell:${cwd}`];
  },
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "Shell command to run" },
      cwd: { type: "string", description: "Working directory (optional)" },
      timeout_ms: {
        type: "number",
        description: "Timeout in milliseconds (default: 30000)",
      },
    },
    required: ["command"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const command = args["command"] as string;
    const cwd = args["cwd"] as string | undefined;
    const timeout = (args["timeout_ms"] as number | undefined) ?? 30_000;

    try {
      const { stdout, stderr } = await execAsync(command, { cwd, timeout });
      const out = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n--- stderr ---\n");
      return { ok: true, output: out || "(no output)" };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  },
});
