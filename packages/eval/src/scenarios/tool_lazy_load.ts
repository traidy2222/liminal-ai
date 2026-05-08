/**
 * Lazy tool loading: minimal API surface until activate_tool_family expands a family.
 */
import type { Scenario } from "../runner.js";
import {
  traceHasOrderedTools,
  traceHasTurnEnd,
  traceToolResults,
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
  {
    name: "tool-lazy-load-vision-activation-hint",
    env: { AGENT_TOOL_LAZY: "1", AGENT_ALWAYS_TOOLS_PROFILE: "balanced" },
    userMessage:
      "Call vision_analyze with image C:\\\\tmp\\\\sample.png and prompt 'describe'. " +
      "Do not activate any family first, then explain blocker in one sentence.",
    maxRounds: 16,
    timeoutMs: 90_000,
    assertions: [
      {
        name: "vision_analyze initially blocked while inactive",
        check: (trace) => {
          const results = traceToolResults(trace, "vision_analyze");
          const first = results.at(0);
          if (!first || first.result.ok) return false;
          return /not loaded for this session/i.test(first.result.error);
        },
      },
      {
        name: "error suggests vision activation",
        check: (trace) => {
          const results = traceToolResults(trace, "vision_analyze");
          const first = results.at(0);
          if (!first || first.result.ok) return false;
          return /activate_tool_family/i.test(first.result.error) && /vision/i.test(first.result.error);
        },
      },
      { name: "turn_end fires", check: (trace) => traceHasTurnEnd(trace) },
    ],
  },
  {
    name: "tool-lazy-load-execute-code-activation-hint",
    env: { AGENT_TOOL_LAZY: "1", AGENT_ALWAYS_TOOLS_PROFILE: "balanced" },
    userMessage:
      "Call execute_code once with language javascript and code console.log(1+1). " +
      "Do not activate any tool family first. Then explain the blocker in one sentence.",
    maxRounds: 16,
    timeoutMs: 90_000,
    assertions: [
      {
        name: "execute_code initially blocked while inactive",
        check: (trace) => {
          const results = traceToolResults(trace, "execute_code");
          const first = results.at(0);
          if (!first || first.result.ok) return false;
          return /not loaded for this session/i.test(first.result.error);
        },
      },
      {
        name: "error suggests code_intel activation",
        check: (trace) => {
          const results = traceToolResults(trace, "execute_code");
          const first = results.at(0);
          if (!first || first.result.ok) return false;
          return /activate_tool_family/i.test(first.result.error) && /code_intel/i.test(first.result.error);
        },
      },
      {
        name: "turn_end fires",
        check: (trace) => traceHasTurnEnd(trace),
      },
    ],
  },
  {
    name: "tool-lazy-load-weather-activation-hint",
    env: { AGENT_TOOL_LAZY: "1", AGENT_ALWAYS_TOOLS_PROFILE: "balanced" },
    userMessage:
      "Call weather_lookup with location Grantham and prefer_live true. " +
      "Do not activate any tool family first. Then explain the blocker in one sentence.",
    maxRounds: 16,
    timeoutMs: 90_000,
    assertions: [
      {
        name: "weather_lookup initially blocked while inactive",
        check: (trace) => {
          const results = traceToolResults(trace, "weather_lookup");
          const first = results.at(0);
          if (!first || first.result.ok) return false;
          return /not loaded for this session/i.test(first.result.error);
        },
      },
      {
        name: "error suggests web activation",
        check: (trace) => {
          const results = traceToolResults(trace, "weather_lookup");
          const first = results.at(0);
          if (!first || first.result.ok) return false;
          return /activate_tool_family/i.test(first.result.error) && /web/i.test(first.result.error);
        },
      },
      {
        name: "turn_end fires",
        check: (trace) => traceHasTurnEnd(trace),
      },
    ],
  },
  {
    name: "tool-lazy-load-post-activation-awareness",
    env: { AGENT_TOOL_LAZY: "1" },
    userMessage:
      "Call list_tool_families. Then activate_tool_family for \"git\". Then call list_tool_families again. " +
      "Finish with one sentence mentioning git is active.",
    maxRounds: 20,
    timeoutMs: 90_000,
    assertions: [
      {
        name: "list->activate->list order holds",
        check: (trace) =>
          traceHasOrderedTools(trace, "list_tool_families", "activate_tool_family") &&
          traceHasOrderedTools(trace, "activate_tool_family", "list_tool_families"),
      },
      {
        name: "post-activation list shows git active count",
        check: (trace) => {
          const lists = traceToolResults(trace, "list_tool_families");
          const last = lists.at(-1);
          if (!last || !last.result.ok) return false;
          return /- git: .*?\(([1-9]\d*)\/\d+ active here\)/i.test(last.result.output);
        },
      },
      {
        name: "post-activation list includes git tool in active tools list",
        check: (trace) => {
          const lists = traceToolResults(trace, "list_tool_families");
          const last = lists.at(-1);
          if (!last || !last.result.ok) return false;
          return /active tools:[\s\S]*\bgit_status\b/i.test(last.result.output);
        },
      },
      {
        name: "turn_end fires",
        check: (trace) => traceHasTurnEnd(trace),
      },
    ],
  },
  {
    name: "tool-lazy-load-files-edit-activation-hint",
    env: { AGENT_TOOL_LAZY: "1", AGENT_ALWAYS_TOOLS_PROFILE: "balanced" },
    userMessage:
      "Call write_file once with path ./tmp-note.txt and content hello world. " +
      "Do not activate any tool family first. Then explain blocker in one sentence.",
    maxRounds: 16,
    timeoutMs: 90_000,
    assertions: [
      {
        name: "write_file initially blocked while inactive",
        check: (trace) => {
          const results = traceToolResults(trace, "write_file");
          const first = results.at(0);
          if (!first || first.result.ok) return false;
          return /not loaded for this session/i.test(first.result.error);
        },
      },
      {
        name: "error suggests files_edit and includes recovery metadata",
        check: (trace) => {
          const results = traceToolResults(trace, "write_file");
          const first = results.at(0);
          if (!first || first.result.ok) return false;
          return (
            /activate_tool_family/i.test(first.result.error) &&
            /files_edit/i.test(first.result.error) &&
            /\[TOOL_RECOVERY\]/i.test(first.result.error) &&
            /active_families=/i.test(first.result.error)
          );
        },
      },
      {
        name: "turn_end fires",
        check: (trace) => traceHasTurnEnd(trace),
      },
    ],
  },
  {
    name: "tool-lazy-load-read-file-chunked-activation-hint",
    env: { AGENT_TOOL_LAZY: "1", AGENT_ALWAYS_TOOLS_PROFILE: "balanced" },
    userMessage:
      "Call read_file_chunked once for path ./README.md with chunk_index 0. " +
      "Do not activate any family first. Then explain blocker in one sentence.",
    maxRounds: 16,
    timeoutMs: 90_000,
    assertions: [
      {
        name: "read_file_chunked initially blocked while inactive",
        check: (trace) => {
          const results = traceToolResults(trace, "read_file_chunked");
          const first = results.at(0);
          if (!first || first.result.ok) return false;
          return /not loaded for this session/i.test(first.result.error);
        },
      },
      {
        name: "error suggests navigation activation",
        check: (trace) => {
          const results = traceToolResults(trace, "read_file_chunked");
          const first = results.at(0);
          if (!first || first.result.ok) return false;
          return /activate_tool_family/i.test(first.result.error) && /navigation/i.test(first.result.error);
        },
      },
      {
        name: "turn_end fires",
        check: (trace) => traceHasTurnEnd(trace),
      },
    ],
  },
  {
    name: "tool-lazy-load-markets-activation-hint",
    env: { AGENT_TOOL_LAZY: "1", AGENT_ALWAYS_TOOLS_PROFILE: "balanced" },
    userMessage:
      "Call markets_quote with symbols ['AAPL'] and asset_type 'equity_etf'. " +
      "Do not activate any tool family first. Then explain the blocker in one sentence.",
    maxRounds: 16,
    timeoutMs: 90_000,
    assertions: [
      {
        name: "markets_quote initially blocked while inactive",
        check: (trace) => {
          const results = traceToolResults(trace, "markets_quote");
          const first = results.at(0);
          if (!first || first.result.ok) return false;
          return /not loaded for this session/i.test(first.result.error);
        },
      },
      {
        name: "error suggests markets activation",
        check: (trace) => {
          const results = traceToolResults(trace, "markets_quote");
          const first = results.at(0);
          if (!first || first.result.ok) return false;
          return /activate_tool_family/i.test(first.result.error) && /markets/i.test(first.result.error);
        },
      },
      {
        name: "turn_end fires",
        check: (trace) => traceHasTurnEnd(trace),
      },
    ],
  },
];
