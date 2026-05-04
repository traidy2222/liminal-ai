import type { Scenario } from "../runner.js";
import { traceHasTool, traceHasTurnEnd } from "../runner.js";

/**
 * Smoke that think() is available (danger pre-flight path depends on it).
 * (Strict same-batch think→shell ordering is model-dependent; not asserted here.)
 */
export const thinkToolSmoke: Scenario = {
  name: "think-tool-smoke",
  userMessage: "Call think with the single word: smoke-check",
  maxRounds: 6,
  timeoutMs: 45_000,
  assertions: [
    { name: "think invoked", check: (t) => traceHasTool(t, "think") },
    { name: "turn_end", check: (t) => traceHasTurnEnd(t) },
  ],
};

export const APPROVAL_CORRECTNESS_SCENARIOS = [thinkToolSmoke];
