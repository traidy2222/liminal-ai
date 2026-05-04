/**
 * Harness quality smoke — path fidelity, round caps (LLM-dependent).
 */
import { existsSync } from "node:fs";
import path from "node:path";
import type { Scenario, TraceEvent } from "../runner.js";
import { traceHasTool, traceHasTurnEnd, traceToolResults } from "../runner.js";

function traceTextBlob(trace: TraceEvent[]): string {
  const texts: string[] = [];
  for (const e of trace) {
    if (e.type === "tool_result") {
      const p = e.payload as { output?: string };
      if (typeof p.output === "string") texts.push(p.output);
    }
    if (e.type === "text") {
      const p = e.payload as { delta?: string };
      if (typeof p.delta === "string") texts.push(p.delta);
    }
  }
  return texts.join("\n");
}

function traceMentionsExistingRepoPaths(trace: TraceEvent[]): boolean {
  const blob = traceTextBlob(trace);
  const dirs = ["packages/core", "packages/web", "packages/tools"];
  if (!dirs.every((n) => blob.includes(n))) return false;
  const cwd = process.cwd();
  return dirs.every((n) => existsSync(path.join(cwd, ...n.split("/"))));
}

export const traceFidelityPaths: Scenario = {
  name: "harness-trace-fidelity-paths",
  userMessage:
    "Call repo_map with scope packages once. Then name three real file paths you saw under packages/ " +
    "that actually exist (use exact slashes as in the listing). Reply with one line: OK",
  maxRounds: 12,
  timeoutMs: 90_000,
  assertions: [
    { name: "repo_map ran", check: (t) => traceHasTool(t, "repo_map") },
    { name: "turn_end", check: (t) => traceHasTurnEnd(t) },
    {
      name: "mentions known repo paths",
      check: (t) => traceMentionsExistingRepoPaths(t),
    },
  ],
};

export const tokenEconomyRounds: Scenario = {
  name: "harness-token-economy-rounds",
  userMessage:
    "In at most 4 tool calls total: use repo_map scope packages, then read_file ONLY packages/core/package.json. " +
    "Summarize the package name in one sentence. Do not list_dir the repo root.",
  maxRounds: 10,
  timeoutMs: 90_000,
  assertions: [
    { name: "turn_end", check: (t) => traceHasTurnEnd(t) },
    {
      name: "limited tool_results",
      check: (t) => traceToolResults(t, "read_file").length + traceToolResults(t, "repo_map").length <= 6,
    },
  ],
};

export const HARNESS_QUALITY_SCENARIOS = [traceFidelityPaths, tokenEconomyRounds];
