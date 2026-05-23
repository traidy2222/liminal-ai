import type { Scenario } from "../runner.js";
import { traceHasTool, traceToolResults, traceHasTurnEnd, traceTerminatedCleanly } from "../runner.js";

/** Real (no-mock) research chain using web_search + web_fetch. */
export const webSearchFetchChain: Scenario = {
  name: "web-search-fetch-chain",
  tags: ["web", "slow"],
  userMessage:
    "What is the chemical symbol for hydrogen? Use web_search once, then web_fetch one result URL, " +
    "then answer in one sentence citing the source.",
  maxRounds: 16,
  timeoutMs: 120_000,
  assertions: [
    { name: "web_search called", check: (t) => traceHasTool(t, "web_search") },
    { name: "web_fetch called", check: (t) => traceHasTool(t, "web_fetch") },
    {
      name: "web_fetch succeeded at least once",
      check: (t) => traceToolResults(t, "web_fetch").some((r) => r.result.ok),
    },
    { name: "terminated cleanly", check: (t) => traceTerminatedCleanly(t) },
    { name: "turn_end", check: (t) => traceHasTurnEnd(t) },
  ],
};

export const WEB_RESEARCH_QUALITY_SCENARIOS = [webSearchFetchChain];
