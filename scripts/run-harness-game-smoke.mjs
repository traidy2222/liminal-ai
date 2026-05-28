#!/usr/bin/env node
/**
 * One-off harness smoke: monolithic HTML airplane game eval.
 * Usage: node scripts/run-harness-game-smoke.mjs
 */
import { runScenario } from "../packages/eval/src/runner.js";
import { monolithicHtmlAirplaneGame } from "../packages/eval/src/scenarios/monolithic_html_game.ts";

const result = await runScenario(monolithicHtmlAirplaneGame);

console.log("\n=== Harness game smoke ===\n");
console.log(JSON.stringify(result, null, 2));

for (const a of result.assertions) {
  const mark = a.passed ? "PASS" : "FAIL";
  console.log(`  [${mark}] ${a.name}`);
}

if (result.error) {
  console.log("\nRun error:", result.error);
}

console.log(
  "\nTools:",
  (result.distinctToolsInvoked ?? []).join(", ") || "(none)",
  "| ok results:",
  result.toolResultOkCount ?? 0
);
console.log("Termination:", result.terminationReason ?? "—");
console.log("Duration:", Math.round(result.durationMs / 1000), "s");

process.exit(result.passed ? 0 : 1);
