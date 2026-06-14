#!/usr/bin/env node
/**
 * Print the latest sandbox-lab eval summary and failed assertions.
 *
 * Usage: node scripts/sandbox-lab-report.mjs
 *        node scripts/sandbox-lab-report.mjs path/to/summary.json
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();
const runsDir = join(repoRoot, ".agent_eval_runs");
const sandboxPrefix = "sandbox-";

function latestSummaryPath() {
  if (!existsSync(runsDir)) return null;
  const files = readdirSync(runsDir)
    .filter((f) => f.startsWith("summary-") && f.endsWith(".json"))
    .sort();
  return files.length ? join(runsDir, files[files.length - 1]) : null;
}

const summaryPath = process.argv[2] ? join(repoRoot, process.argv[2]) : latestSummaryPath();
if (!summaryPath || !existsSync(summaryPath)) {
  console.error("No summary JSON found. Run: npm run eval:sandbox -w packages/eval");
  process.exit(1);
}

const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
const sandboxRows = (summary.perScenario ?? []).filter((r) =>
  String(r.scenario).startsWith(sandboxPrefix)
);

if (sandboxRows.length === 0) {
  console.log(`No sandbox scenarios in ${summaryPath}`);
  process.exit(0);
}

const passed = sandboxRows.filter((r) => r.passed).length;
console.log(`Sandbox lab — ${passed}/${sandboxRows.length} passed`);
console.log(`Summary: ${summaryPath}\n`);

for (const row of sandboxRows) {
  const icon = row.passed ? "✓" : "✗";
  const sec = ((row.durationMs ?? 0) / 1000).toFixed(1);
  console.log(`${icon} ${row.scenario} (${sec}s)`);
}

const failures = (summary.failures ?? []).filter((f) =>
  String(f.scenario).startsWith(sandboxPrefix)
);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) {
    console.log(`  - ${f.scenario}: ${f.error ?? f.terminationReason ?? "assertion failed"}`);
  }
}

const runsPath = join(runsDir, "runs.jsonl");
if (existsSync(runsPath)) {
  const lines = readFileSync(runsPath, "utf8").trim().split("\n");
  const recent = lines
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((row) => row && String(row.scenario).startsWith(sandboxPrefix))
    .slice(-sandboxRows.length);

  const failedAssertions = recent.flatMap((row) =>
    (row.assertions ?? [])
      .filter((a) => !a.passed)
      .map((a) => ({ scenario: row.scenario, name: a.name }))
  );
  if (failedAssertions.length > 0) {
    console.log("\nFailed assertions (latest runs):");
    for (const a of failedAssertions) {
      console.log(`  - ${a.scenario}: ${a.name}`);
    }
  }
}

process.exit(passed === sandboxRows.length ? 0 : 1);
