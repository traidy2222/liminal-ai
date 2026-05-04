/**
 * Harness quality smoke — path fidelity, round caps (LLM-dependent).
 */
import type { Scenario } from "../runner.js";
import {
  traceHasTool,
  traceHasTurnEnd,
  traceToolResults,
  traceMentionsAny,
  traceToolRanOk,
} from "../runner.js";

export const traceFidelityPaths: Scenario = {
  name: "harness-trace-fidelity-paths",
  userMessage:
    "Call repo_map with scope packages once. Then name three real file paths you saw under packages/ " +
    "that actually exist (use exact slashes as in the listing). Reply with one line: OK",
  maxRounds: 12,
  tags: ["retrieval"],
  assertions: [
    { name: "repo_map ran ok", check: (t) => traceToolRanOk(t, "repo_map") },
    { name: "turn_end", check: (t) => traceHasTurnEnd(t) },
    {
      name: "mentions known repo paths (flexible)",
      check: (t) =>
        traceMentionsAny(t, [
          "packages/core",
          "packages/web",
          "packages/tools",
          "packages\\core",
          "packages\\web",
          "packages\\tools",
        ]),
    },
  ],
};

export const tokenEconomyRounds: Scenario = {
  name: "harness-token-economy-rounds",
  userMessage:
    "In at most 4 tool calls total: use repo_map scope packages, then read_file ONLY packages/core/package.json. " +
    "Summarize the package name in one sentence. Do not list_dir the repo root.",
  maxRounds: 10,
  tags: ["retrieval"],
  assertions: [
    { name: "turn_end", check: (t) => traceHasTurnEnd(t) },
    {
      name: "limited tool_results",
      check: (t) => traceToolResults(t, "read_file").length + traceToolResults(t, "repo_map").length <= 6,
    },
  ],
};

export const HARNESS_QUALITY_SCENARIOS = [traceFidelityPaths, tokenEconomyRounds];
