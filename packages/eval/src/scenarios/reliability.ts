/**
 * ReliabilityBench-style (arXiv:2601.06112) and harness telemetry checks.
 */
import type { Scenario } from "../runner.js";
import { traceHasTurnEnd, traceGetHarnessMetrics } from "../runner.js";

/** turn_end must carry harnessMetrics for orchestration / eval surfaces. */
export const turnEndHarnessMetricsPresent: Scenario = {
  name: "turn-end-harness-metrics",
  userMessage: "Reply with exactly the single word: OK",
  maxRounds: 6,
  timeoutMs: 45_000,
  assertions: [
    {
      name: "turn_end fires",
      check: (trace) => traceHasTurnEnd(trace),
    },
    {
      name: "harnessMetrics present on turn_end",
      check: (trace) => {
        const m = traceGetHarnessMetrics(trace);
        if (!m) return false;
        return (
          Array.isArray(m.toolsInvokedThisSend) &&
          typeof m.spawnAgentCallsThisSend === "number" &&
          typeof m.parallelToolCallsLastBatch === "number"
        );
      },
    },
  ],
};

/**
 * pass@2 on a trivial completion task (consistency under repeated execution).
 */
export const passAt2Consistency: Scenario = {
  name: "pass-at-2-consistency",
  userMessage: "Reply with only: DONE",
  passAtK: 2,
  maxRounds: 5,
  timeoutMs: 45_000,
  assertions: [
    {
      name: "turn_end each run",
      check: (trace) => traceHasTurnEnd(trace),
    },
  ],
};

/**
 * Semantic perturbation (ε): both phrasings must complete a turn.
 */
export const epsilonParaphrasePair: Scenario = {
  name: "epsilon-paraphrase-pair",
  userMessage: "Respond with exactly one word: PING",
  paraphrases: ["Answer using exactly one token: PING"],
  maxRounds: 6,
  timeoutMs: 45_000,
  assertions: [
    {
      name: "turn_end on both variants",
      check: (trace) => traceHasTurnEnd(trace),
    },
  ],
};

export const RELIABILITY_SCENARIOS = [
  turnEndHarnessMetricsPresent,
  passAt2Consistency,
  epsilonParaphrasePair,
];
