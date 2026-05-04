/**
 * Memory / retrieval smoke — requires model to follow tool-use instruction.
 */
import type { Scenario } from "../runner.js";
import { traceHasTool, traceHasTurnEnd } from "../runner.js";

export const recallRelevantInvoked: Scenario = {
  name: "memory-recall-relevant-invoked",
  userMessage:
    "Call the tool recall_relevant exactly once with JSON args: " +
    '{"query":"liminal workspace","scope":"notes","k":3}. ' +
    "Then reply with the single word: OK.",
  maxRounds: 14,
  timeoutMs: 90_000,
  assertions: [
    {
      name: "recall_relevant tool ran",
      check: (trace) => traceHasTool(trace, "recall_relevant"),
    },
    {
      name: "turn_end",
      check: (trace) => traceHasTurnEnd(trace),
    },
  ],
};

export const MEMORY_SCENARIOS = [recallRelevantInvoked];
