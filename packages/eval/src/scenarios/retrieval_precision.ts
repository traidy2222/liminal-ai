import type { Scenario } from "../runner.js";
import type { ToolResult } from "@liminal/core";
import { traceHasTool, traceToolResults } from "../runner.js";

export const retrievalPrecisionMock: Scenario = {
  name: "retrieval-precision-mock",
  userMessage: "Call recall_relevant with query \"needle\" k=3 scope notes only.",
  maxRounds: 8,
  timeoutMs: 45_000,
  mocks: [
    {
      toolName: "recall_relevant",
      handler: async (): Promise<ToolResult> => ({
        ok: true,
        output: "## Notes\n- [fact:needle] score=0.99 — the needle fact\n- [fact:noise] score=0.1 — distractor",
      }),
    },
  ],
  assertions: [
    { name: "recall_called", check: (t) => traceHasTool(t, "recall_relevant") },
    {
      name: "top hit is needle",
      check: (t) => {
        const hits = traceToolResults(t, "recall_relevant");
        const last = hits[hits.length - 1];
        const out =
          last && last.result.ok && typeof last.result.output === "string"
            ? last.result.output
            : "";
        return out.includes("fact:needle") && /needle.*\n/.test(out);
      },
    },
  ],
};

export const RETRIEVAL_PRECISION_SCENARIOS = [retrievalPrecisionMock];
