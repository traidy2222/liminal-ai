import type { Scenario } from "../runner.js";
import type { ToolResult } from "@liminal/core";
import { traceHasTool, traceHasTurnEnd } from "../runner.js";

/** Critic-style path: verify_result returns issues (mocked). */
export const criticIssuesMock: Scenario = {
  name: "critic-issues-mock",
  userMessage:
    "Call verify_result with goal \"test\" and result \"claimed success\" (exact strings). Do nothing else.",
  maxRounds: 12,
  timeoutMs: 90_000,
  env: { AGENT_CRITIC: "0" },
  mocks: [
    {
      toolName: "verify_result",
      handler: async (): Promise<ToolResult> => ({
        ok: true,
        output: "✗ ISSUES FOUND: mock contradiction for eval",
      }),
    },
  ],
  assertions: [
    { name: "verify_result invoked", check: (t) => traceHasTool(t, "verify_result") },
    { name: "turn_end", check: (t) => traceHasTurnEnd(t) },
  ],
};

export const CONTRADICTION_SCENARIOS = [criticIssuesMock];
