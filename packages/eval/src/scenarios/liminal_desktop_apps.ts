/**
 * Liminal desktop apps — agent should prefer spawn_app over write_file for widgets.
 */
import type { Scenario } from "../runner.js";
import {
  traceHasTool,
  traceHasTurnEnd,
  traceToolRanOk,
  traceToolResults,
} from "../runner.js";

export const LIMINAL_DESKTOP_APPS_SCENARIOS: Scenario[] = [
  {
    name: "liminal-apps-weather-spawn-not-write-file",
    env: {
      AGENT_TOOL_LAZY: "1",
      AGENT_LIMINAL_APPS: "1",
      AGENT_LIMINAL_APPS_DESKTOP: "1",
      AGENT_EVAL_LIMINAL_APPS_MOCK: "1",
      AGENT_YOLO: "1",
    },
    userMessage:
      "Open a persistent weather desktop window for London, UK (metric). " +
      "Use spawn_app only — do not write_file any HTML. After spawn succeeds, reply in one sentence.",
    maxRounds: 16,
    timeoutMs: 120_000,
    tags: ["smoke"],
    assertions: [
      {
        name: "spawn_app succeeded",
        check: (trace) => traceToolRanOk(trace, "spawn_app"),
      },
      {
        name: "did not write_file html substitute",
        check: (trace) => {
          const writes = traceToolResults(trace, "write_file");
          return !writes.some((w) => {
            if (!w.result.ok) return false;
            const path = String((w.args as Record<string, unknown>)["path"] ?? "");
            return /\.html?$/i.test(path);
          });
        },
      },
      {
        name: "spawn_app used weather type",
        check: (trace) => {
          const results = traceToolResults(trace, "spawn_app");
          return results.some((r) => {
            const args = r.args as Record<string, unknown>;
            return args["type"] === "weather";
          });
        },
      },
      {
        name: "turn_end fires",
        check: (trace) => traceHasTurnEnd(trace),
      },
    ],
  },
  {
    name: "liminal-apps-list-types-visible",
    env: {
      AGENT_TOOL_LAZY: "1",
      AGENT_LIMINAL_APPS: "1",
      AGENT_EVAL_LIMINAL_APPS_MOCK: "1",
    },
    userMessage:
      "Call list_app_types once and report how many desktop app types exist in one short sentence.",
    maxRounds: 8,
    timeoutMs: 60_000,
    tags: ["smoke"],
    assertions: [
      {
        name: "list_app_types available without manual activation",
        check: (trace) => traceHasTool(trace, "list_app_types") && traceToolRanOk(trace, "list_app_types"),
      },
      { name: "turn_end fires", check: (trace) => traceHasTurnEnd(trace) },
    ],
  },
];
