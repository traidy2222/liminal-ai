/**
 * Epistemic / harness metrics surface checks.
 */
import type { Scenario } from "../runner.js";
import { traceHasTurnEnd, traceHasEpistemicState } from "../runner.js";

export const epistemicTurnEndHasState: Scenario = {
  name: "epistemic-turn-end-has-state",
  userMessage:
    "Reply with exactly one word: PING. Do not call any tools.",
  maxRounds: 6,
  timeoutMs: 45_000,
  assertions: [
    { name: "turn_end fires", check: (t) => traceHasTurnEnd(t) },
    {
      name: "harnessMetrics.epistemicState present",
      check: (t) => traceHasEpistemicState(t),
    },
  ],
};

export const EPISTEMIC_SCENARIOS = [epistemicTurnEndHasState];
