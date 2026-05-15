import type { Scenario } from "../runner.js";
import { traceHasTool, traceHasTurnEnd } from "../runner.js";

/**
 * Smoke that think() is available as a structured reasoning tool.
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

export const spawnContractSignalSmoke: Scenario = {
  name: "spawn-contract-signal-smoke",
  userMessage:
    "Spawn one sub-agent with goal only and then wait_for_agents for it. Reply OK.",
  maxRounds: 10,
  timeoutMs: 60_000,
  assertions: [
    { name: "spawn invoked", check: (t) => traceHasTool(t, "spawn_agent") },
    {
      name: "spawn contract event seen",
      check: (t) => t.some((e) => e.type === "spawn_contract_created"),
    },
    { name: "turn_end", check: (t) => traceHasTurnEnd(t) },
  ],
};

export const APPROVAL_CORRECTNESS_SCENARIOS = [thinkToolSmoke, spawnContractSignalSmoke];
