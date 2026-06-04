/**
 * Google connectors eval — skipped unless AGENT_EVAL_GOOGLE=1.
 */
import type { Scenario } from "../runner.js";
import { traceHasTool } from "../runner.js";

export const GOOGLE_CONNECTORS_SCENARIOS: Scenario[] =
  process.env.AGENT_EVAL_GOOGLE === "1"
    ? [
        {
          name: "google-list-connectors",
          userMessage: "Call list_connectors and summarize Google OAuth status in one paragraph.",
          maxRounds: 8,
          timeoutMs: 60_000,
          tags: ["connectors"],
          assertions: [
            {
              name: "list_connectors was called",
              check: (trace) => traceHasTool(trace, "list_connectors"),
            },
          ],
        },
      ]
    : [];
