/**
 * self_telemetry — surfaces the harness's own learning data to the model.
 *
 * The harness continuously records failure categories (.agent_failures.jsonl),
 * harness-rule effectiveness (.agent_rule_stats.json), high-reuse tool recipes
 * and reasoning-effort outcomes (.agent_recipe_stats.json). Until now none of it
 * was readable mid-session. This tool closes that loop: the model can ask which
 * approaches have been failing, or which recipe fits the current goal, and
 * self-correct before retrying.
 *
 * Stateless — reads the persisted telemetry files via the workspace root, so it
 * needs no harness handle and copies cleanly to child agents.
 */
import {
  formatFailureDigestForWorldContext,
  formatRuleStatsReport,
  formatTopRecipes,
  formatEffortStatsReport,
} from "@liminal/core";
import { defineTool } from "./helpers.js";

type Aspect = "failures" | "rules" | "recipes" | "effort" | "all";

const ASPECTS: readonly Aspect[] = ["failures", "rules", "recipes", "effort", "all"];

export const selfTelemetryTool = defineTool({
  name: "self_telemetry",
  description:
    "WHAT: Report the harness's own learning telemetry — recent failure categories, " +
    "harness-rule effectiveness, high-reuse tool recipes, and reasoning-effort outcomes.\n" +
    "WHEN: To self-correct mid-task — check which tools/approaches have been failing, " +
    "or which recipe fits the current goal, before retrying a stuck step.\n" +
    "NOT WHEN: A fresh workspace with no history (sections return '(no … yet)').\n" +
    "ARGS: aspect — failures | rules | recipes | effort | all (default all); " +
    "top_n — max rows per section (default 10).",
  requiresApproval: false,
  dangerLevel: "safe",
  cacheable: true,
  cacheTtlMs: 15_000,
  parameters: {
    type: "object",
    properties: {
      aspect: {
        type: "string",
        enum: [...ASPECTS],
        description: "Which telemetry section to report (default all)",
      },
      top_n: {
        type: "number",
        description: "Max rows per section (default 10, clamped 1–50)",
      },
    },
    additionalProperties: false,
  },
  handler: async (args) => {
    const rawAspect = (args["aspect"] as string | undefined)?.trim() ?? "all";
    const aspect: Aspect = ASPECTS.includes(rawAspect as Aspect)
      ? (rawAspect as Aspect)
      : "all";
    const topN = Math.min(50, Math.max(1, (args["top_n"] as number | undefined) ?? 10));
    const want = (a: Aspect): boolean => aspect === "all" || aspect === a;

    try {
      const sections: string[] = [];
      if (want("failures")) {
        const digest = await formatFailureDigestForWorldContext();
        sections.push(`## Failures\n${digest ?? "(no recent failures logged)"}`);
      }
      if (want("rules")) {
        sections.push(`## Harness rule effectiveness\n${await formatRuleStatsReport(topN)}`);
      }
      if (want("recipes")) {
        sections.push(`## Recipe library\n${await formatTopRecipes(topN)}`);
      }
      if (want("effort")) {
        sections.push(`## Reasoning-effort outcomes\n${await formatEffortStatsReport()}`);
      }
      return { ok: true, output: sections.join("\n\n") };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `self_telemetry failed: ${msg}` };
    }
  },
});
