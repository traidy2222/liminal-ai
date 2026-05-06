/**
 * Memory / retrieval smoke — requires model to follow tool-use instruction.
 */
import type { Scenario } from "../runner.js";
import { traceCollectTextBlob, traceHasTool, traceHasTurnEnd } from "../runner.js";

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

export const introspectionDebiasNoRandomRecall: Scenario = {
  name: "memory-introspection-debias-no-random-recall",
  userMessage: "Can you fully manage yourself and the harness? Answer briefly and do not use web.",
  maxRounds: 8,
  timeoutMs: 60_000,
  env: {
    AGENT_MEMORY_DEBIAS: "1",
    AGENT_MEMORY_INTROSPECTION_STRICT: "1",
  },
  assertions: [
    { name: "turn_end", check: (trace) => traceHasTurnEnd(trace) },
    {
      name: "memory retrieval policy emitted",
      check: (trace) => trace.some((e) => e.type === "memory_retrieval_policy"),
    },
    {
      name: "auto recall disabled for introspection",
      check: (trace) =>
        trace.some(
          (e) =>
            e.type === "memory_retrieval_policy" &&
            (e.payload as { intent?: string; autoRecallAllowed?: boolean }).intent === "introspection" &&
            (e.payload as { autoRecallAllowed?: boolean }).autoRecallAllowed === false
        ),
    },
    {
      name: "no unrelated historical-war leakage in assistant text",
      check: (trace) => !/\biran war|strait of hormuz|khamenei\b/i.test(traceCollectTextBlob(trace)),
    },
  ],
};

export const specificOldMemoryStillRetrievable: Scenario = {
  name: "memory-specific-old-note-still-retrievable",
  userMessage:
    'Use memory_query in lexical mode with query "iran_war_2026_overview". Then summarize the retrieved memory in one sentence.',
  maxRounds: 10,
  timeoutMs: 75_000,
  env: {
    AGENT_MEMORY_DEBIAS: "1",
  },
  assertions: [
    { name: "turn_end", check: (trace) => traceHasTurnEnd(trace) },
    {
      name: "memory_query tool ran",
      check: (trace) => traceHasTool(trace, "memory_query"),
    },
    {
      name: "assistant uses targeted retrieval content",
      check: (trace) => /iran_war_2026_overview|iran war/i.test(traceCollectTextBlob(trace)),
    },
  ],
};

export const MEMORY_SCENARIOS = [
  recallRelevantInvoked,
  introspectionDebiasNoRandomRecall,
  specificOldMemoryStillRetrievable,
];
