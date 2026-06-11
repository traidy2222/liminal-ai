import type { AgentHarness } from "@liminal/core";
import { defineTool } from "../../shared/helpers.js";
import { ensureChatTerminal } from "./terminal_runtime.js";
import { startAgentTerminalWarmup } from "./agent_shell_session.js";

export function createOpenTerminalTool(harness: AgentHarness) {
  return defineTool({
    name: "open_terminal",
    description:
      "WHAT: Open an interactive terminal tab in the chat UI (visible to the user).\n" +
      "WHEN: Before long shell work the user should watch, or when you need a dedicated shell separate from the default agent terminal.\n" +
      "NOT WHEN: run_shell already runs in the agent terminal — only needed for an extra labeled tab.\n" +
      "By default reuses the primary agent terminal; set new_session:true for an additional tab.\n" +
      "ARGS: label — short tab title; new_session — open a fresh tab; cwd — optional start directory.",
    requiresApproval: false,
    dangerLevel: "safe",
    parameters: {
      type: "object",
      properties: {
        label: { type: "string", description: "Short tab label (e.g. 'npm test', 'dev server')" },
        new_session: {
          type: "boolean",
          description: "When true, always spawn a new terminal tab instead of reusing the primary one.",
        },
        cwd: { type: "string", description: "Optional working directory inside the workspace" },
      },
      additionalProperties: false,
    },
    handler: async (args) => {
      const chatId = harness.taskId?.trim();
      if (!chatId) {
        return { ok: false, error: "No active chat context for open_terminal." };
      }
      const label = typeof args["label"] === "string" ? args["label"].trim() : "";
      const forceNew = args["new_session"] === true;
      const cwd = typeof args["cwd"] === "string" ? args["cwd"].trim() : undefined;
      const result = await ensureChatTerminal({
        chatId,
        label: label || undefined,
        source: "agent",
        forceNew,
        cwd: cwd || undefined,
        focus: true,
      });
      if (!result) {
        return { ok: false, error: "Terminal UI is not available in this runtime." };
      }
      return {
        ok: true,
        output: `Terminal ready: ${result.label} (session ${result.sessionId})\ncwd: ${result.cwd}`,
      };
    },
  });
}

/** Begin Agent shell open + boot wait as soon as a shell tool is requested (before handler runs). */
export function wireTerminalHarness(harness: AgentHarness): void {
  const chatId = harness.taskId?.trim();
  if (!chatId) return;
  harness.emitter.on("tool_start", (p) => {
    if (p.name !== "run_shell" && p.name !== "run_background") return;
    void startAgentTerminalWarmup(chatId);
  });
}
