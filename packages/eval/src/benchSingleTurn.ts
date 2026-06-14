/**
 * One-scenario latency bench — prints tool + wall-clock breakdown.
 * Usage: node --env-file=../../.env --import tsx/esm src/benchSingleTurn.ts [scenario-name]
 */
import "./evalWorkspaceBootstrap.js";
process.env["EVAL_SANDBOX_LAB"] = "1";

import { runSingleHarnessSend, traceToolResults } from "./runner.js";
import type { Scenario } from "./runner.js";
import { SANDBOX_CAPABILITY_LAB_SCENARIOS } from "./scenarios/sandbox_capability_lab.js";

const name = process.argv[2] ?? "sandbox-read-edit-verify";
const scenario: Scenario | undefined = SANDBOX_CAPABILITY_LAB_SCENARIOS.find((s) => s.name === name);
if (!scenario) {
  console.error(`Unknown scenario: ${name}`);
  process.exit(1);
}

const t0 = Date.now();
const { trace, durationMs, runError, sandboxRoot, modelSlug } = await runSingleHarnessSend(
  scenario,
  scenario.userMessage
);
const wallMs = Date.now() - t0;

const toolTimings = trace
  .filter((e) => e.type === "tool_timing")
  .map((e) => e.payload as { name: string; durationMs: number; callId: string });

const toolResults = trace.filter((e) => e.type === "tool_result");
const turnEnd = trace.find((e) => e.type === "turn_end");
const metrics = turnEnd
  ? (turnEnd.payload as { harnessMetrics?: { terminationReason?: string; roundCount?: number } })
      .harnessMetrics
  : undefined;

console.log("\n=== bench:", scenario.name, "===");
console.log("model_used:", modelSlug ?? "?");
console.log("wall_ms:", wallMs, "runner_duration_ms:", durationMs);
console.log("run_error:", runError ?? "(none)");
console.log("termination:", metrics?.terminationReason ?? "?");
console.log("rounds:", metrics?.roundCount ?? "?");
console.log("sandbox:", sandboxRoot ?? "(none)");

console.log("\n--- tool results ---");
for (const e of toolResults) {
  const p = e.payload as { name: string; result: { ok: boolean } };
  console.log(`  ${p.name} ok=${p.result.ok}`);
}

console.log("\n--- tool_timing (harness dispatch only) ---");
let toolSum = 0;
for (const t of toolTimings) {
  toolSum += t.durationMs;
  console.log(`  ${t.name}: ${t.durationMs}ms`);
}
console.log("tool_dispatch_sum_ms:", toolSum);
console.log("estimated_llm+overhead_ms:", Math.max(0, durationMs - toolSum));

const gaps: { label: string; ms: number }[] = [];
let last = trace[0]?.at ?? t0;
for (const e of trace) {
  if (!e.at) continue;
  const gap = e.at - last;
  if (gap > 500) {
    const label =
      e.type === "tool_result"
        ? `→ ${(e.payload as { name: string }).name}`
        : e.type === "tool_start"
          ? `start ${(e.payload as { name: string }).name}`
          : e.type === "turn_end"
            ? "turn_end"
            : e.type;
    gaps.push({ label, ms: gap });
  }
  last = e.at;
}
gaps.sort((a, b) => b.ms - a.ms);
console.log("\n--- largest inter-event gaps (>500ms) ---");
for (const g of gaps.slice(0, 12)) {
  console.log(`  ${g.ms}ms  ${g.label}`);
}

const readEdit = traceToolResults(trace, "read_file");
const editEdit = traceToolResults(trace, "edit_file");
console.log("\nread_file calls:", readEdit.length, "edit_file calls:", editEdit.length);
