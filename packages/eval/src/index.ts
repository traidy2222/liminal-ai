#!/usr/bin/env node
/**
 * Eval CLI entry point.
 * Usage: npm run eval -w packages/eval
 *
 * Flags:
 *   --parallel <n>   Run up to n scenarios concurrently (default 3 when flag present without value).
 *   --only <filter>  Substring match on scenario name, or pack alias `research-grade` / `long-horizon`.
 *   (Alias: --eval-only also works.)
 *   --repeat <k>     Run each scenario k times (fresh harness each time).
 *   --any-pass       With --repeat: pass if any run passes (default: all k must pass).
 *
 * Exit code 0 = all scenarios passed. Exit code 1 = one or more failed.
 * Requires: AGENT_API_KEY (preferred) or provider-specific key env var.
 *
 * Optional: AGENT_EVAL_JSON_SINK=1 appends structured lines to .agent_eval_runs/runs.jsonl
 * and writes .agent_eval_runs/summary-<ts>.json after the suite.
 */
import {
  runScenario,
  appendEvalRunJsonLine,
  flushEvalJsonSink,
  EVAL_MODEL,
  type ScenarioResult,
  type Scenario,
  writeEvalRunSummary,
} from "./runner.js";
import { ALL_SCENARIOS as BASIC_SCENARIOS } from "./scenarios/basic.js";
import { RELIABILITY_SCENARIOS } from "./scenarios/reliability.js";
import { NOISE_SCENARIOS } from "./scenarios/noise.js";
import { MEMORY_SCENARIOS } from "./scenarios/memory_retrieval.js";
import { HARNESS_QUALITY_SCENARIOS } from "./scenarios/harness_quality.js";
import { EPISTEMIC_SCENARIOS } from "./scenarios/epistemic_eval.js";
import { MULTI_HOP_SCENARIOS } from "./scenarios/multi_hop.js";
import { CONTRADICTION_SCENARIOS } from "./scenarios/contradiction.js";
import { RETRIEVAL_PRECISION_SCENARIOS } from "./scenarios/retrieval_precision.js";
import { CONTEXT_ROT_SCENARIOS } from "./scenarios/context_rot.js";
import { APPROVAL_CORRECTNESS_SCENARIOS } from "./scenarios/approval_correctness.js";
import { WEB_RESEARCH_QUALITY_SCENARIOS } from "./scenarios/web_research_quality.js";
import {
  RESEARCH_GRADE_SCENARIOS,
} from "./scenarios/research_grade.js";
import { HARNESS_CAPABILITY_SCENARIOS } from "./scenarios/harness_capability.js";
import { LONG_HORIZON_SCENARIOS } from "./scenarios/long_horizon.js";
import { TOOL_LAZY_LOAD_SCENARIOS } from "./scenarios/tool_lazy_load.js";
import { DOCUMENT_SCENARIOS } from "./scenarios/document_quality.js";
import { DOCUMENT_AUTONOMY_SCENARIOS } from "./scenarios/document_autonomy.js";
import { LARGE_FILE_WRITE_SCENARIOS } from "./scenarios/large_file_write.js";
import { BROWSER_LOCAL_SCENARIOS } from "./scenarios/browser_local.js";
import { REASONING_BUDGET_SCENARIOS } from "./scenarios/reasoning_budget.js";
import { HARNESS_RELIABILITY_SCENARIOS } from "./scenarios/harness_reliability.js";
import { WORKFLOW_EVAL_SCENARIOS } from "./scenarios/workflow_evals.js";

const ALL_SCENARIOS = [
  ...BASIC_SCENARIOS,
  ...RELIABILITY_SCENARIOS,
  ...NOISE_SCENARIOS,
  ...MEMORY_SCENARIOS,
  ...HARNESS_QUALITY_SCENARIOS,
  ...EPISTEMIC_SCENARIOS,
  ...MULTI_HOP_SCENARIOS,
  ...CONTRADICTION_SCENARIOS,
  ...RETRIEVAL_PRECISION_SCENARIOS,
  ...CONTEXT_ROT_SCENARIOS,
  ...APPROVAL_CORRECTNESS_SCENARIOS,
  ...WEB_RESEARCH_QUALITY_SCENARIOS,
  ...RESEARCH_GRADE_SCENARIOS,
  ...HARNESS_CAPABILITY_SCENARIOS,
  ...LONG_HORIZON_SCENARIOS,
  ...TOOL_LAZY_LOAD_SCENARIOS,
  ...DOCUMENT_SCENARIOS,
  ...DOCUMENT_AUTONOMY_SCENARIOS,
  ...LARGE_FILE_WRITE_SCENARIOS,
  ...BROWSER_LOCAL_SCENARIOS,
  ...REASONING_BUDGET_SCENARIOS,
  ...HARNESS_RELIABILITY_SCENARIOS,
  ...WORKFLOW_EVAL_SCENARIOS,
];
const REAL_SCENARIOS = ALL_SCENARIOS.filter((s) => !s.mocks || s.mocks.length === 0);

const RESEARCH_GRADE_SET = new Set<Scenario>(RESEARCH_GRADE_SCENARIOS);
const LONG_HORIZON_SET = new Set<Scenario>(LONG_HORIZON_SCENARIOS);

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

function parseCli(argv: string[]) {
  /** Default parallel batch size (plan: 3) when --parallel is omitted. */
  let parallel = 3;
  let only: string | undefined;
  let repeat = 1;
  let anyPass = false;

  const pIdx = argv.indexOf("--parallel");
  if (pIdx !== -1) {
    const raw = argv[pIdx + 1];
    if (raw && !raw.startsWith("--")) {
      parallel = Math.max(1, parseInt(raw, 10) || 3);
    } else {
      parallel = 3;
    }
  }

  const oIdx = argv.indexOf("--only");
  const eoIdx = argv.indexOf("--eval-only");
  const pickIdx = eoIdx !== -1 ? eoIdx : oIdx;
  if (pickIdx !== -1) {
    const v = argv[pickIdx + 1];
    if (v && !v.startsWith("--")) only = v;
  }

  const rIdx = argv.indexOf("--repeat");
  if (rIdx !== -1) {
    const v = argv[rIdx + 1];
    if (v && !v.startsWith("--")) repeat = Math.max(1, parseInt(v, 10) || 1);
  }

  if (argv.includes("--any-pass")) anyPass = true;

  return { parallel, only, repeat, anyPass };
}

function selectScenarios(only: string | undefined): Scenario[] {
  let list = REAL_SCENARIOS;
  if (!only) return list;
  if (only === "research-grade") {
    return list.filter((s) => RESEARCH_GRADE_SET.has(s));
  }
  if (only === "long-horizon") {
    return list.filter((s) => LONG_HORIZON_SET.has(s));
  }
  return list.filter((s) => s.name.includes(only));
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Math.min(Math.max(1, concurrency), items.length);
  const run = async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: workers }, run));
  return results;
}

async function runScenarioWithRepeat(
  scenario: Scenario,
  repeat: number,
  anyPass: boolean
): Promise<ScenarioResult> {
  if (scenario.passAtK !== undefined && scenario.passAtK > 1) {
    return runScenario(scenario);
  }
  if (repeat <= 1) {
    return runScenario(scenario);
  }

  const runs: ScenarioResult[] = [];
  for (let i = 0; i < repeat; i++) {
    runs.push(
      await runScenario({
        ...scenario,
        passAtK: undefined,
        skipJsonSink: true,
      })
    );
  }

  const passed = anyPass ? runs.some((r) => r.passed) : runs.every((r) => r.passed);
  const winner = runs.find((r) => r.passed) ?? runs[runs.length - 1]!;
  const assertions = runs.flatMap((r, ri) =>
    r.assertions.map((a) => ({
      name: `[repeat ${ri + 1}/${repeat}] ${a.name}`,
      passed: a.passed,
    }))
  );

  const merged: ScenarioResult = {
    scenario: scenario.name,
    passed,
    assertions,
    durationMs: runs.reduce((s, r) => s + r.durationMs, 0),
    error: runs.find((r) => r.error)?.error,
    terminationReason: winner.terminationReason ?? null,
    toolResultOkCount: winner.toolResultOkCount,
    distinctToolsInvoked: winner.distinctToolsInvoked,
  };
  await appendEvalRunJsonLine(merged);
  return merged;
}

async function main() {
  const hasKey = Boolean(
    process.env["AGENT_API_KEY"] ||
      process.env["OPENROUTER_API_KEY"] ||
      process.env["OPENAI_API_KEY"] ||
      process.env["ANTHROPIC_API_KEY"] ||
      process.env["XAI_API_KEY"]
  );
  if (!hasKey) {
    console.error(
      fmt(
        RED,
        "✗ No provider API key set — define AGENT_API_KEY (preferred) or OPENROUTER/OPENAI/ANTHROPIC/XAI key."
      )
    );
    process.exit(1);
  }

  const argv = process.argv.slice(2);
  const { parallel, only, repeat, anyPass } = parseCli(argv);
  const scenarios = selectScenarios(only);

  console.log(`\n${fmt(BOLD, "Liminal eval")}  ${fmt(DIM, `model: ${EVAL_MODEL}`)}\n`);
  console.log(
    fmt(
      DIM,
      `Running ${scenarios.length} real (no-mock) scenarios ` +
        `(parallel=${parallel}, repeat=${repeat}${anyPass ? ", any-pass" : ""})…\n`
    )
  );

  const suiteStartedAt = Date.now();
  const results: ScenarioResult[] =
    parallel <= 1
      ? await Promise.all(
          scenarios.map((scenario) => runScenarioWithRepeat(scenario, repeat, anyPass))
        )
      : await mapPool(scenarios, parallel, (scenario) =>
          runScenarioWithRepeat(scenario, repeat, anyPass)
        );

  let anyFailed = false;
  for (let i = 0; i < results.length; i++) {
    const result = results[i]!;
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

  await flushEvalJsonSink();
  await writeEvalRunSummary(results, suiteStartedAt);

  process.exit(anyFailed ? 1 : 0);
}

main().catch((err) => {
  console.error(fmt(RED, String(err)));
  process.exit(1);
});
