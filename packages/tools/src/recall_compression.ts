/**
 * recall_compression — re-expand what was lost during context compression.
 *
 * When ACON-lite compression fires, old tool rounds are replaced with structured
 * summary blocks. This tool surfaces those summaries so the model can reason
 * about what happened before the compression horizon, or request specific
 * artifacts via read_artifact(hash) if AGENT_DISTILL=1 was active.
 */
import type { ContextManager } from "@liminal/core";
import { defineTool } from "./helpers.js";

export function createRecallCompressionTool(context: ContextManager) {
  return defineTool({
    name: "recall_compression",
    description:
      "WHAT: Retrieve the compression summary block(s) stored in the current context when old rounds were collapsed.\n" +
      "WHEN: You need to recall what happened before the compression horizon — tool outputs, subtask results, or earlier findings that were summarised away.\n" +
      "NOT WHEN: Context has not been compressed (check_context will tell you); for full raw tool output, use read_artifact(hash) if AGENT_DISTILL was on.\n" +
      "ARGS: none. Returns all CONTEXT COMPRESSED blocks in chronological order.",
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    handler: async (_args) => {
      const summaries = context.getCompressionSummaries();
      if (summaries.length === 0) {
        const snap = context.snapshot();
        const pct = Math.round(snap.usageFraction * 100);
        return {
          ok: true,
          output:
            `No compression blocks found in the current context (usage: ${pct}%). ` +
            "Context has not been compressed yet — all rounds are available inline.",
        };
      }
      const formatted = summaries
        .map((s, i) => `=== Compression block ${i + 1} of ${summaries.length} ===\n${s}`)
        .join("\n\n");
      return {
        ok: true,
        output:
          `Found ${summaries.length} compression block(s). ` +
          "If a specific tool output is needed in full, call read_artifact(hash) if hash is shown below.\n\n" +
          formatted,
      };
    },
  });
}
