/**
 * paste_train — mine pattern store from session JSONLs on demand.
 *
 * Used to refresh `~/.liminal/paste_patterns.json` after new sessions land.
 * Stateless and safe; intended for manual / scheduled invocation rather than
 * mid-turn use.
 */
import {
  minePatternsFromSessions,
  savePatternStore,
  refreshPatternStoreCache,
  loadPatternStore,
  patternStorePath,
} from "@liminal/core";
import { defineTool } from "./helpers.js";

export const pasteTrainTool = defineTool({
  name: "paste_train",
  description:
    "WHAT: Mine speculative-execution patterns from session JSONLs and refresh the PASTE pattern store.\n" +
    "WHEN: After accumulating new sessions, or when AGENT_PASTE_PREDICTIVE telemetry shows few promotions.\n" +
    "NOT WHEN: Mid-turn — this scans all sessions and is comparatively expensive. Schedule it instead.\n" +
    "ARGS: context_window (default 2) — trailing-tool-name window used as the lookup key. " +
    "min_support (default 3) — minimum observations before a pattern is kept.",
  requiresApproval: false,
  dangerLevel: "safe",
  parameters: {
    type: "object",
    properties: {
      context_window: {
        type: "number",
        minimum: 1,
        maximum: 5,
        description: "Trailing tool-name window. Default 2.",
      },
      min_support: {
        type: "number",
        minimum: 1,
        maximum: 100,
        description: "Minimum observations per context key. Default 3.",
      },
    },
  },
  handler: async (args) => {
    const ctxWindow = typeof args["context_window"] === "number" ? (args["context_window"] as number) : 2;
    const minSupport = typeof args["min_support"] === "number" ? (args["min_support"] as number) : 3;
    try {
      const patterns = await minePatternsFromSessions({
        contextWindow: ctxWindow,
        minSupport,
      });
      const filePath = await savePatternStore(patterns);
      refreshPatternStoreCache(await loadPatternStore());
      const top = patterns
        .slice(0, 8)
        .map((p) => `  - ${p.contextKey} → ${p.nextTool}  p=${p.probability.toFixed(2)} (n=${p.support})`)
        .join("\n");
      return {
        ok: true,
        output:
          `paste_train: ${patterns.length} pattern(s) written to ${patternStorePath()}\n` +
          (top ? `top:\n${top}\n` : "(no patterns met the support floor)\n") +
          `(file path: ${filePath})`,
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
});
