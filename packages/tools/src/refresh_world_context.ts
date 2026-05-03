import type { AgentHarness } from "@liminal/core";
import { buildWorldContextMessage } from "@liminal/core";
import { defineTool } from "./helpers.js";

/**
 * Factory: creates a refresh_world_context tool scoped to a specific root harness.
 * Re-injects an updated [WORLD CONTEXT] block mid-session — useful for long-running
 * sessions where git state, active ports, or system resources may have changed.
 *
 * This is harness-scoped (like check_context / compress_context) and must be
 * added to ORCHESTRATION_TOOL_NAMES so child agents don't inherit it.
 */
export function createRefreshWorldContextTool(harness: AgentHarness) {
  return defineTool({
    name: "refresh_world_context",
    description:
      "WHAT: Re-inject an up-to-date [WORLD CONTEXT] block into the session.\n" +
      "WHEN: The session has been running long enough that date/time, git state, active ports, " +
      "or system resources may have changed and you need accurate current values.\n" +
      "NOT WHEN: The session just started — the initial world context is already fresh.\n" +
      "ARGS: none.",
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    handler: async (_args) => {
      const worldCtx = await buildWorldContextMessage(harness.config.worldContext);
      if (!worldCtx) {
        return { ok: true, output: "World context is disabled (worldContext.disabled = true)." };
      }
      const ctx = harness.getContext();
      ctx.append({ role: "user", content: worldCtx });
      ctx.append({
        role: "assistant",
        content: "[World context refreshed. Using updated date/time, git state, and system info.]",
      });
      return { ok: true, output: "World context refreshed with current date/time, git, ports, and system data." };
    },
  });
}
