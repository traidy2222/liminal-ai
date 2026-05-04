/**
 * AgentNoiseBench-style (arXiv:2602.11348) user-noise stress via paraphrases.
 */
import type { Scenario } from "../runner.js";
import { traceHasTurnEnd } from "../runner.js";

/** Typos and filler should still yield a completed turn (robustness smoke). */
export const noisyUserVariants: Scenario = {
  name: "noisy-user-variants",
  userMessage: "uhh can u just say YES pls one word thx",
  paraphrases: [
    "Plese respond with only YES (typo intentional)",
    "YES or NO only — answer YES",
  ],
  maxRounds: 8,
  timeoutMs: 50_000,
  assertions: [
    {
      name: "all noisy variants reach turn_end",
      check: (trace) => traceHasTurnEnd(trace),
    },
  ],
};

export const NOISE_SCENARIOS = [noisyUserVariants];
