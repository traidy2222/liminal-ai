/**
 * ReliabilityBench-style (arXiv:2601.06112) and harness telemetry checks.
 */
import type { Scenario } from "../runner.js";
import { traceHasTurnEnd, traceGetHarnessMetrics } from "../runner.js";

function queryOverlap(a: string, b: string): number {
  const toks = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((x) => x.length >= 3)
    );
  const as = toks(a);
  const bs = toks(b);
  if (as.size === 0 || bs.size === 0) return 0;
  let inter = 0;
  for (const t of as) if (bs.has(t)) inter += 1;
  return inter / new Set([...as, ...bs]).size;
}

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

export const runtimeCoherenceSignalsPresent: Scenario = {
  name: "runtime-coherence-signals-present",
  userMessage:
    "Create a 4-step plan, run at least one read_file call, and finish with DONE.",
  maxRounds: 12,
  timeoutMs: 90_000,
  assertions: [
    {
      name: "turn_end fires",
      check: (trace) => traceHasTurnEnd(trace),
    },
    {
      name: "execution_state telemetry emitted",
      check: (trace) => trace.some((e) => e.type === "execution_state"),
    },
    {
      name: "runtime heartbeat emitted",
      check: (trace) => trace.some((e) => e.type === "runtime_heartbeat"),
    },
  ],
};

export const vaultFirstOrderScenario: Scenario = {
  name: "vault-first-order-scenario",
  userMessage:
    "Research-style task: first check memory/vault, then optionally use web search. " +
    "Do memory_query scope both and vault_search before web_search, then summarize.",
  maxRounds: 14,
  timeoutMs: 90_000,
  env: {
    AGENT_VAULT_FIRST: "1",
    AGENT_TOOL_LAZY: "1",
  },
  assertions: [
    {
      name: "vault or memory retrieval ran",
      check: (trace) =>
        trace.some(
          (e) =>
            e.type === "tool_result" &&
            ["memory_query", "recall_relevant", "vault_search", "vault_read"].includes(
              (e.payload as { name?: string }).name ?? ""
            )
        ),
    },
    {
      name: "vault activity emitted",
      check: (trace) => trace.some((e) => e.type === "vault_activity"),
    },
    { name: "turn_end fires", check: (trace) => traceHasTurnEnd(trace) },
  ],
};

export const researchQueryDiversityScenario: Scenario = {
  name: "research-query-diversity",
  userMessage:
    "Research a fast-moving topic. Use web_search at least three times with different angles " +
    "(origins/background, latest status, impact/metrics), then summarize.",
  maxRounds: 14,
  timeoutMs: 90_000,
  assertions: [
    {
      name: "first three web_search queries are diversified",
      check: (trace) => {
        const queries = trace
          .filter((e) => e.type === "tool_result")
          .filter((e) => (e.payload as { name?: string }).name === "web_search")
          .map((e) => ((e.payload as { args?: Record<string, unknown> }).args?.query as string | undefined) ?? "")
          .filter((q) => q.length >= 6)
          .slice(0, 3);
        if (queries.length < 3) return false;
        return (
          queryOverlap(queries[0]!, queries[1]!) < 0.72 &&
          queryOverlap(queries[0]!, queries[2]!) < 0.72 &&
          queryOverlap(queries[1]!, queries[2]!) < 0.72
        );
      },
    },
    { name: "turn_end fires", check: (trace) => traceHasTurnEnd(trace) },
  ],
};

export const antiLoopDuplicateIntentScenario: Scenario = {
  name: "anti-loop-duplicate-intent",
  userMessage:
    "Try web_search for the exact phrase 'zzzz impossible topic 12345' repeatedly if needed, " +
    "but stop if retries are blocked and then explain what happened.",
  maxRounds: 10,
  timeoutMs: 75_000,
  assertions: [
    {
      name: "duplicate intent throttle triggered",
      check: (trace) =>
        trace.some(
          (e) =>
            e.type === "tool_result" &&
            (e.payload as { name?: string }).name === "web_search" &&
            /Blocked repeated failing intent|Repeated failed web_search intent/i.test(
              ((e.payload as { result?: { error?: string } }).result?.error ?? "") as string
            )
        ),
    },
    { name: "turn_end fires", check: (trace) => traceHasTurnEnd(trace) },
  ],
};

export const RELIABILITY_SCENARIOS = [
  turnEndHarnessMetricsPresent,
  passAt2Consistency,
  epsilonParaphrasePair,
  runtimeCoherenceSignalsPresent,
  vaultFirstOrderScenario,
  researchQueryDiversityScenario,
  antiLoopDuplicateIntentScenario,
];
