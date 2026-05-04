import type { Scenario } from "../runner.js";
import { traceHasTurnEnd, traceGetSnapshot } from "../runner.js";

const longPreamble = "context ".repeat(400);

export const contextRotLongUser: Scenario = {
  name: "context-rot-long-user",
  userMessage:
    longPreamble +
    "\n\nAfter that padding, reply with exactly one word: ROTOK.",
  maxRounds: 8,
  timeoutMs: 60_000,
  assertions: [
    { name: "turn_end", check: (t) => traceHasTurnEnd(t) },
    {
      name: "snapshot valid",
      check: (t) => {
        const s = traceGetSnapshot(t);
        return s !== null && s.tokenCount > 0 && s.usageFraction > 0;
      },
    },
  ],
};

export const CONTEXT_ROT_SCENARIOS = [contextRotLongUser];
