/**
 * Browser session workflow — integration eval (requires Playwright + Chromium).
 * Skipped unless AGENT_BROWSER_INTEGRATION=1.
 */
import type { Scenario } from "../runner.js";
import { traceHasTurnEnd, traceToolRanOk, traceToolResults } from "../runner.js";

const INTEGRATION = process.env["AGENT_BROWSER_INTEGRATION"] === "1";

export const BROWSER_LOCAL_SCENARIOS: Scenario[] = INTEGRATION
  ? [
      {
        name: "browser-local-fixture-click",
        env: { AGENT_BROWSER: "1", AGENT_TOOL_LAZY: "0" },
        userMessage:
          "Use browser_serve_file with path packages/tools/fixtures/browser/button.html. " +
          "Then browser_open on the SERVE_URL with include_console true and include_snapshot true. " +
          "From SNAPSHOT_REFS use browser_act with session_id and one click_ref on the button ref. " +
          "Confirm status shows clicked. browser_close the session. Reply DONE when finished.",
        maxRounds: 20,
        timeoutMs: 180_000,
        assertions: [
          {
            name: "browser_serve_file succeeded",
            check: (trace) => traceToolRanOk(trace, "browser_serve_file"),
          },
          {
            name: "browser_open succeeded",
            check: (trace) => traceToolRanOk(trace, "browser_open"),
          },
          {
            name: "browser_act succeeded",
            check: (trace) => traceToolRanOk(trace, "browser_act"),
          },
          {
            name: "open output has session and snapshot refs",
            check: (trace) => {
              const opens = traceToolResults(trace, "browser_open");
              const last = opens.at(-1);
              return (
                last?.result.ok === true &&
                /SESSION_ID:/i.test(String(last.result.output ?? "")) &&
                /SNAPSHOT_REFS/i.test(String(last.result.output ?? ""))
              );
            },
          },
          {
            name: "browser_close succeeded",
            check: (trace) => traceToolRanOk(trace, "browser_close"),
          },
          { name: "turn_end fires", check: (trace) => traceHasTurnEnd(trace) },
        ],
      },
      {
        name: "browser-goto-in-session",
        env: { AGENT_BROWSER: "1", AGENT_TOOL_LAZY: "0" },
        userMessage:
          "Open https://the-internet.herokuapp.com/ with browser_open (include_snapshot true). " +
          "Use browser_act with session_id and a single goto action to https://the-internet.herokuapp.com/login. " +
          "Confirm the output URL or body mentions login. browser_close when done. Reply DONE.",
        maxRounds: 18,
        timeoutMs: 180_000,
        assertions: [
          {
            name: "browser_open succeeded",
            check: (trace) => traceToolRanOk(trace, "browser_open"),
          },
          {
            name: "browser_act goto succeeded",
            check: (trace) => {
              const acts = traceToolResults(trace, "browser_act");
              return acts.some(
                (a) =>
                  a.result.ok === true &&
                  /login/i.test(String(a.result.output ?? "")) &&
                  /goto|URL:/i.test(String(a.result.output ?? ""))
              );
            },
          },
          {
            name: "browser_close succeeded",
            check: (trace) => traceToolRanOk(trace, "browser_close"),
          },
          { name: "turn_end fires", check: (trace) => traceHasTurnEnd(trace) },
        ],
      },
    ]
  : [];
