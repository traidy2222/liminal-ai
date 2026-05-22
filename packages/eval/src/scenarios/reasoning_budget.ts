/**
 * Adaptive reasoning budget — tools should follow brief budgets, not reasoning-only essays.
 */
import type { Scenario } from "../runner.js";
import type { TraceEvent } from "../runner.js";
import {
  traceCollectTextBlob,
  traceHasTool,
  traceToolRanOk,
} from "../runner.js";
import type { AgentEventMap } from "@liminal/core";

function traceFirstToolResultIndex(trace: TraceEvent[], toolName: string): number {
  let idx = 0;
  for (const e of trace) {
    if (e.type !== "tool_result") continue;
    const p = e.payload as AgentEventMap["tool_result"];
    if (p.name === toolName) return idx;
    idx++;
  }
  return -1;
}

function traceToolResultCount(trace: TraceEvent[]): number {
  return trace.filter((e) => e.type === "tool_result").length;
}

export const reasoningImplementHello: Scenario = {
  name: "reasoning-implement-hello",
  userMessage:
    "In the eval workspace, create hello.py that prints exactly Hello, run it with python, and reply OK when the script output is correct. " +
    "Use write_file and run_shell — do not paste the full file only in chat.",
  maxRounds: 14,
  tags: ["smoke", "reasoning"],
  assertions: [
    {
      name: "write_file or run_shell succeeded",
      check: (t) => traceToolRanOk(t, "write_file") || traceToolRanOk(t, "run_shell"),
    },
    {
      name: "implementation tools early (within first 8 tool results)",
      check: (t) => {
        const writeIdx = traceFirstToolResultIndex(t, "write_file");
        const shellIdx = traceFirstToolResultIndex(t, "run_shell");
        const first = [writeIdx, shellIdx].filter((i) => i >= 0);
        if (first.length === 0) return false;
        const earliest = Math.min(...first);
        return earliest < 8 && traceToolResultCount(t) >= 1;
      },
    },
    {
      name: "reply mentions OK",
      check: (t) => traceCollectTextBlob(t).toUpperCase().includes("OK"),
    },
  ],
};

export const reasoningTspTrap: Scenario = {
  name: "reasoning-tsp-trap",
  userMessage:
    "LeCun claimed a zero-shot LLM can solve the Traveling Salesman Problem optimally. " +
    "Implement a Python program in tsp_demo.py that solves TSP optimally for n=50 cities with random coordinates, " +
    "run it, and show the tour length. Use tools — do not only describe the algorithm in reasoning text.",
  maxRounds: 16,
  tags: ["reasoning", "slow"],
  assertions: [
    {
      name: "trace shows reasoning budget line",
      check: (t) => /\[reasoning: effort=/.test(traceCollectTextBlob(t)),
    },
    {
      name: "at least one implementation tool invoked",
      check: (t) =>
        traceHasTool(t, "write_file") ||
        traceHasTool(t, "run_shell") ||
        traceHasTool(t, "think"),
    },
    {
      name: "not reasoning-only turn (mutate or run attempted)",
      check: (t) => traceHasTool(t, "write_file") || traceHasTool(t, "run_shell"),
    },
    {
      name: "feasibility or tools before excessive stall",
      check: (t) => {
        const b = traceCollectTextBlob(t).toLowerCase();
        const hasFeasibility =
          b.includes("np-hard") ||
          b.includes("infeasible") ||
          b.includes("impossible") ||
          b.includes("exponential") ||
          b.includes("heuristic") ||
          b.includes("approximation");
        return (
          traceHasTool(t, "write_file") ||
          traceHasTool(t, "run_shell") ||
          (hasFeasibility && traceToolResultCount(t) >= 1)
        );
      },
    },
  ],
};

export const reasoningBudgetFallback: Scenario = {
  name: "reasoning-budget-fallback",
  userMessage:
    "Add a one-line comment to packages/core/package.json name field area explaining this is the core package. " +
    "Use read_file then edit_file. Reply OK.",
  maxRounds: 12,
  env: {
    AGENT_INTENT_INFERENCE: "0",
    AGENT_REASONING_BUDGET: "1",
  },
  tags: ["reasoning", "smoke"],
  assertions: [
    {
      name: "fallback high effort in trace",
      check: (t) => /\[reasoning: effort=high/.test(traceCollectTextBlob(t)),
    },
    {
      name: "read_file used",
      check: (t) => traceToolRanOk(t, "read_file"),
    },
  ],
};

export const reasoningSurfaceNativeTrace: Scenario = {
  name: "reasoning-surface-trace-native",
  userMessage: "Reply with exactly SURFACE_OK and nothing else.",
  maxRounds: 4,
  tags: ["reasoning", "smoke"],
  assertions: [
    {
      name: "trace includes surface=native for deepseek default",
      check: (t) => {
        const blob = traceCollectTextBlob(t);
        if (/deepseek\//i.test(process.env.AGENT_MODEL ?? "")) {
          return /\[reasoning:.*surface=native/.test(blob);
        }
        return /\[reasoning:.*surface=/.test(blob);
      },
    },
    {
      name: "reply SURFACE_OK",
      check: (t) => traceCollectTextBlob(t).includes("SURFACE_OK"),
    },
  ],
};

export const REASONING_BUDGET_SCENARIOS: Scenario[] = [
  reasoningImplementHello,
  reasoningTspTrap,
  reasoningBudgetFallback,
  reasoningSurfaceNativeTrace,
];
