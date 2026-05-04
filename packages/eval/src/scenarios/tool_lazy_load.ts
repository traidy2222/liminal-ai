/**
 * Lazy tool loading: minimal API surface until activate_tool_family expands a family.
 */
import type { Scenario } from "../runner.js";
import {
  traceHasOrderedTools,
  traceHasTurnEnd,
  traceToolRanOk,
} from "../runner.js";

export const TOOL_LAZY_LOAD_SCENARIOS: Scenario[] = [
  {
    name: "tool-lazy-load-git-smoke",
    env: { AGENT_TOOL_LAZY: "1" },
    userMessage:
      "First call list_tool_families with empty arguments. " +
      "Then call activate_tool_family with family exactly \"git\". " +
      "Then call git_status once. End with one sentence that includes the word \"branch\" or \"clean\" or \"dirty\" from git output.",
    maxRounds: 24,
    timeoutMs: 90_000,
    assertions: [
      {
        name: "list_tool_families succeeded",
        check: (trace) => traceToolRanOk(trace, "list_tool_families"),
      },
      {
        name: "activate_tool_family succeeded after list",
        check: (trace) =>
          traceHasOrderedTools(trace, "list_tool_families", "activate_tool_family") &&
          traceToolRanOk(trace, "activate_tool_family"),
      },
      {
        name: "git_status succeeded after activation",
        check: (trace) =>
          traceHasOrderedTools(trace, "activate_tool_family", "git_status") &&
          traceToolRanOk(trace, "git_status"),
      },
      {
        name: "turn_end fires",
        check: (trace) => traceHasTurnEnd(trace),
      },
    ],
  },
];
