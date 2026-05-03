import type { ContextManager } from "@dreamthedream/core";
import { defineTool } from "./helpers.js";

/**
 * Proactive Context Budget Tools (#5 — MEM1 arXiv:2506.15841)
 *
 * check_context    — returns current token usage % and compression status.
 * compress_context — forces immediate compression of old rounds, anchored by
 *                    a caller-provided summary string.
 *
 * Both tools are created as a factory that closes over a ContextManager instance,
 * so they must be created after the harness is constructed and registered via
 * harness.getContext().
 */
export function createContextTools(context: ContextManager) {
  const checkContextTool = defineTool({
    name: "check_context",
    description:
      "WHAT: Show current context window usage (% of token budget used) and compression status.\n" +
      "WHEN: At the start of a task expected to be long (5+ steps), or whenever you suspect context is getting full.\n" +
      "NOT WHEN: Quick single-step tasks — not worth the overhead.\n" +
      "ARGS: none.",
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    handler: async (_args) => {
      const snap = context.snapshot();
      const pct = Math.round(snap.usageFraction * 100);
      const statusIcon = pct >= 85 ? "⚠ CRITICAL" : pct >= 60 ? "⚠ HIGH" : "✓ OK";
      const advice =
        pct >= 85
          ? "Call compress_context() immediately — compression is about to discard early details."
          : pct >= 60
          ? "Consider calling compress_context() before continuing long work."
          : "Plenty of budget remaining.";
      return {
        ok: true,
        output:
          `Context: ${pct}% used [${statusIcon}]\n` +
          `Tokens: ~${snap.tokenCount.toLocaleString()} / ${snap.maxTokens.toLocaleString()}\n` +
          `Compression active: ${snap.masked ? "yes" : "no"}\n` +
          `Advice: ${advice}`,
      };
    },
  });

  const compressContextTool = defineTool({
    name: "compress_context",
    description:
      "WHAT: Immediately compress old conversation rounds to free context budget.\n" +
      "WHEN: Context usage is above 60% and you have completed a major subtask whose full detail is no longer needed.\n" +
      "NOT WHEN: You might still need the detailed outputs from early rounds — use check_context first.\n" +
      "ARGS: summary — brief description of completed work to anchor the compressed block.",
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "What has been accomplished in the rounds being compressed",
        },
      },
      required: ["summary"],
      additionalProperties: false,
    },
    handler: async (args) => {
      const before = context.snapshot();
      const pctBefore = Math.round(before.usageFraction * 100);
      context.forceCompress(args["summary"] as string);
      const after = context.snapshot();
      const pctAfter = Math.round(after.usageFraction * 100);
      return {
        ok: true,
        output:
          `Context compressed: ${pctBefore}% → ${pctAfter}% ` +
          `(freed ~${pctBefore - pctAfter}% of budget).\n` +
          `Summary anchored: "${(args["summary"] as string).slice(0, 80)}${(args["summary"] as string).length > 80 ? "…" : ""}"`,
      };
    },
  });

  return { checkContextTool, compressContextTool };
}
