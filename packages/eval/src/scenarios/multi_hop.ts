import type { Scenario } from "../runner.js";
import type { ToolResult } from "@liminal/core";
import { traceHasTool, traceHasTurnEnd } from "../runner.js";

export const multiHopRecallMock: Scenario = {
  name: "multi-hop-recall-mock",
  userMessage:
    "Call recall_relevant once with query \"task\" and k=4 scope notes. " +
    "If the tool output mentions both fact:alpha and fact:beta, reply exactly: OK",
  maxRounds: 10,
  timeoutMs: 60_000,
  mocks: [
    {
      toolName: "recall_relevant",
      handler: async (_args, _orig): Promise<ToolResult> => ({
        ok: true,
        output:
          "## Notes\n" +
          "- [fact:alpha] score=0.9 — alpha describes variable a\n" +
          "- [fact:beta] score=0.88 — beta describes variable b\n",
      }),
    },
  ],
  assertions: [
    { name: "recall_relevant invoked", check: (t) => traceHasTool(t, "recall_relevant") },
    { name: "turn_end", check: (t) => traceHasTurnEnd(t) },
  ],
};

export const MULTI_HOP_SCENARIOS = [multiHopRecallMock];
