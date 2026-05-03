#!/usr/bin/env node
/**
 * Eval CLI entry point.
 * Usage: npm run eval -w packages/eval
 *
 * Exit code 0 = all scenarios passed. Exit code 1 = one or more failed.
 * Requires: OPENROUTER_API_KEY env var.
 */
import { runScenario, type ScenarioResult } from "./runner.js";
import { ALL_SCENARIOS } from "./scenarios/basic.js";

const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";

function fmt(color: string, text: string) {
  return `${color}${text}${RESET}`;
}

function printResult(r: ScenarioResult) {
  const icon = r.passed ? fmt(GREEN, "✓") : fmt(RED, "✗");
  const name = fmt(r.passed ? GREEN : RED, r.scenario);
  const time = fmt(DIM, `(${(r.durationMs / 1000).toFixed(1)}s)`);
  console.log(`  ${icon}  ${name}  ${time}`);

  if (r.error) {
    console.log(`     ${fmt(RED, "Error:")} ${r.error}`);
  }

  for (const a of r.assertions) {
    const aIcon = a.passed ? fmt(DIM, "  ·") : fmt(YELLOW, "  !");
    const aName = a.passed ? fmt(DIM, a.name) : fmt(YELLOW, a.name);
    const aStatus = a.passed ? fmt(DIM, "pass") : fmt(YELLOW, "FAIL");
    console.log(`     ${aIcon}  ${aName}  ${aStatus}`);
  }
}

async function main() {
  if (!process.env["OPENROUTER_API_KEY"]) {
    console.error(
      fmt(RED, "✗ OPENROUTER_API_KEY is not set — eval requires a real API key.")
    );
    process.exit(1);
  }

  const model = process.env["EVAL_MODEL"] ?? "openai/gpt-4o-mini";
  console.log(
    `\n${fmt(BOLD, "Liminal eval")}  ${fmt(DIM, `model: ${model}`)}\n`
  );
  console.log(fmt(DIM, `Running ${ALL_SCENARIOS.length} scenarios…\n`));

  const results: ScenarioResult[] = [];
  let anyFailed = false;

  for (const scenario of ALL_SCENARIOS) {
    process.stdout.write(
      `  ${fmt(CYAN, "⟳")}  ${scenario.name}  ${fmt(DIM, "running…")}\r`
    );
    const result = await runScenario(scenario);
    results.push(result);
    if (!result.passed) anyFailed = true;
    printResult(result);
  }

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  const totalMs = results.reduce((s, r) => s + r.durationMs, 0);

  console.log(
    `\n${fmt(BOLD, "Results:")}  ` +
      `${fmt(passed === total ? GREEN : RED, `${passed}/${total} passed`)}  ` +
      `${fmt(DIM, `(${(totalMs / 1000).toFixed(1)}s total)`)}\n`
  );

  process.exit(anyFailed ? 1 : 0);
}

main().catch((err) => {
  console.error(fmt(RED, String(err)));
  process.exit(1);
});
