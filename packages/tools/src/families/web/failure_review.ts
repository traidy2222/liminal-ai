/**
 * Read recent AGENT_FAILURE_LOG rows and suggest protocol improvements.
 */
import { defineTool } from "../../shared/helpers.js";
import { readFile } from "node:fs/promises";
import { failureLogPath } from "@liminal/core";

export const failureReviewTool = defineTool({
  name: "failure_review",
  description:
    "WHAT: Read last N lines from .agent_failures.jsonl (requires AGENT_FAILURE_LOG=1 during runs).\n" +
    "WHEN: Debugging harness regressions or recurring tool failures.\n" +
    "ARGS: tail — max lines to read (default 40, max 200).",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      tail: { type: "number", description: "Lines from end of log (default 40)" },
    },
    additionalProperties: false,
  },
  handler: async (args) => {
    const tail = Math.min(200, Math.max(5, (args["tail"] as number | undefined) ?? 40));
    try {
      const raw = await readFile(failureLogPath(), "utf8");
      const lines = raw.trim().split("\n").filter(Boolean);
      const slice = lines.slice(-tail);
      if (slice.length === 0) {
        return {
          ok: true,
          output:
            "(empty log) Enable AGENT_FAILURE_LOG=1 during agent runs, then use suggest_improvement with these patterns.",
        };
      }
      const grouped = new Map<string, number>();
      for (const ln of slice) {
        try {
          const o = JSON.parse(ln) as { category?: string };
          const c = o.category ?? "unknown";
          grouped.set(c, (grouped.get(c) ?? 0) + 1);
        } catch {
          grouped.set("parse_error", (grouped.get("parse_error") ?? 0) + 1);
        }
      }
      const summary = [...grouped.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `- ${k}: ${v}`)
        .join("\n");
      return {
        ok: true,
        output:
          `## Failure log (last ${slice.length} lines)\n` +
          `### Counts by category\n${summary}\n\n### Raw (most recent)\n` +
          slice.slice(-12).join("\n") +
          `\n\n→ Consider suggest_improvement() with concrete protocol edits.`,
      };
    } catch {
      return {
        ok: true,
        output: "(no .agent_failures.jsonl yet — enable AGENT_FAILURE_LOG=1 and reproduce failures)",
      };
    }
  },
});
