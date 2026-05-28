#!/usr/bin/env node
/**
 * Run exactly one eval scenario by name (substring match).
 * Usage: node --import tsx/esm scripts/run-one-eval.mjs write-file-code-smoke
 */
import { config } from "dotenv";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: join(repoRoot, ".env") });
process.env.AGENT_YOLO = process.env.AGENT_YOLO ?? "1";

const filter = process.argv[2]?.trim();
if (!filter) {
  console.error("Usage: node scripts/run-one-eval.mjs <scenario-name-substring>");
  process.exit(2);
}

const { runSingleHarnessSend, EVAL_MODEL, traceToolResults } = await import(
  "../packages/eval/src/runner.js"
);
const { LARGE_FILE_WRITE_SCENARIOS } = await import(
  "../packages/eval/src/scenarios/large_file_write.ts"
);

const scenario = LARGE_FILE_WRITE_SCENARIOS.find((s) => s.name.includes(filter));
if (!scenario) {
  console.error(`No scenario matching "${filter}" in large_file_write pack.`);
  process.exit(2);
}

console.log(`\n=== One eval: ${scenario.name} ===`);
console.log(`Model: ${EVAL_MODEL}\n`);

const { trace, runError, durationMs } = await runSingleHarnessSend(scenario, scenario.userMessage);

for (const a of scenario.assertions) {
  let passed = false;
  try {
    passed = a.check(trace);
  } catch {
    passed = false;
  }
  console.log(`  [${passed ? "PASS" : "FAIL"}] ${a.name}`);
}

const writes = traceToolResults(trace, "write_file");
if (writes.length) {
  console.log("\nwrite_file calls:");
  for (const w of writes) {
    console.log(`  path=${w.args?.path ?? "?"} mode=${w.args?.mode ?? "create"} ok=${w.result.ok}`);
    const line = w.result.ok ? w.result.output : w.result.error;
    console.log(`    ${String(line).split("\n")[0]?.slice(0, 120)}`);
  }
} else {
  console.log("\n(no write_file tool_result in trace)");
}

for (const rel of [".agent_artifacts/eval-hello.js", ".agent_artifacts/eval-two-part.txt"]) {
  const abs = join(repoRoot, rel);
  if (existsSync(abs)) {
    console.log(`\n--- ${rel} ---`);
    console.log(readFileSync(abs, "utf8"));
  }
}

if (runError) console.log("\nRun error:", runError);
console.log(`\nDuration: ${Math.round(durationMs / 1000)}s`);
const allPassed = scenario.assertions.every((a) => {
  try {
    return a.check(trace);
  } catch {
    return false;
  }
});
process.exit(allPassed && !runError ? 0 : 1);
