import type { Scenario } from "../runner.js";
import type { ToolResult } from "@liminal/core";
import { traceHasTool, traceToolResults, traceHasTurnEnd } from "../runner.js";

export const webResearchStructuredMock: Scenario = {
  name: "web-research-structured-mock",
  userMessage:
    "Call the tool web_research with question \"What is hydrogen?\" and k_sources 2. " +
    "Then reply OK.",
  maxRounds: 10,
  timeoutMs: 60_000,
  env: { AGENT_WEB_RESEARCH: "1" },
  mocks: [
    {
      toolName: "web_research",
      handler: async (): Promise<ToolResult> => ({
        ok: true,
        output:
          "## web_research\n### Synthesis (JSON)\n" +
          `{"agreements":["H is element 1"],"disagreements":[],"confidence":"high"}`,
      }),
    },
  ],
  assertions: [
    { name: "web_research called", check: (t) => traceHasTool(t, "web_research") },
    {
      name: "output has agreements json",
      check: (t) => {
        const xs = traceToolResults(t, "web_research");
        const out = xs.map((x) => (x.result.ok ? x.result.output : "")).join("\n");
        return out.includes("agreements") && out.includes("confidence");
      },
    },
    { name: "turn_end", check: (t) => traceHasTurnEnd(t) },
  ],
};

export const WEB_RESEARCH_QUALITY_SCENARIOS = [webResearchStructuredMock];
