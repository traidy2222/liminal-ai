#!/usr/bin/env node
import fs from "node:fs/promises";
import { matchesRequestedRecord } from "./lib/procedure-oracle.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url))),
  root = path.resolve(
    process.argv[2] ??
      path.join(
        repo,
        ".agent_artifacts/procedural-memory/comparison-" + Date.now(),
      ),
  );
await fs.mkdir(root);
const convention = {
  schemaVersion: 1,
  family: "json-record",
  name: "Register provider",
  directory: "src/providers",
  filenameParameter: "name",
  fields: {
    name: { parameter: "name" },
    symbol: { parameter: "symbol" },
    kind: { constant: "provider" },
  },
  allowAdditionalFields: false,
};
// Frozen expected values live in the parent evaluator, not in any learner tool.
const cases = [
  {
    phase: "transfer",
    name: "maple",
    symbol: "Maple",
    directory: "src/providers",
  },
  {
    phase: "unrelated",
    name: "birch",
    symbol: "Birch",
    directory: "src/providers",
  },
  {
    phase: "drift",
    name: "juniper",
    symbol: "Juniper",
    directory: "src/extensions",
  },
];
await fs.writeFile(
  path.join(root, "frozen-oracle.json"),
  JSON.stringify(cases, null, 2),
);
const results = [];
for (const mode of [
  "A",
  "B",
  "C",
  "D",
  "no-dependencies",
  "no-episode-validation",
  "whole-repository",
]) {
  const base = path.join(root, mode);
  await fs.mkdir(path.join(base, "repo"), { recursive: true });
  await fs.writeFile(
    path.join(base, "repo/convention.json"),
    JSON.stringify(convention),
  );
  for (const phase of ["acquire", ...cases.map((c) => c.phase)]) {
    if (phase === "unrelated")
      await fs.writeFile(
        path.join(base, "repo/README.md"),
        "Unrelated documentation change",
      );
    if (phase === "drift")
      await fs.writeFile(
        path.join(base, "repo/convention.json"),
        JSON.stringify({ ...convention, directory: "src/extensions" }),
      );
    const r = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        path.join(repo, "packages/eval/src/procedural/comparison_worker.ts"),
        base,
        mode,
        phase,
      ],
      {
        cwd: repo,
        windowsHide: true,
        encoding: "utf8",
        timeout: 90000,
        maxBuffer: 1000000,
      },
    );
    await fs.writeFile(
      path.join(base, phase + ".process.log"),
      r.stdout + r.stderr,
    );
    assert.equal(r.status, 0, r.stderr);
    const report = JSON.parse(
      await fs.readFile(path.join(base, phase + ".report.json"), "utf8"),
    );
    if (phase === "acquire") {
      results.push({ ...report, split: "acquisition" });
      continue;
    }
    const task = cases.find((c) => c.phase === phase);
    let actual = null;
    try {
      actual = JSON.parse(
        await fs.readFile(
          path.join(base, "repo", task.directory, task.name + ".json"),
          "utf8",
        ),
      );
    } catch {}
    const correct = matchesRequestedRecord(actual, task);
    let stale = false;
    if (phase === "drift")
      try {
        await fs.stat(path.join(base, "repo/src/providers/juniper.json"));
        stale = true;
      } catch {}
    await fs.writeFile(
      path.join(base, phase + ".evaluation.json"),
      JSON.stringify(
        {
          mode,
          phase,
          correct,
          staleSideEffect: stale,
          inputs: task,
          recordedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    results.push({
      ...report,
      trace: undefined,
      split: "held_out",
      correct,
      harmfulReuse: report.reused && !correct,
      staleSideEffect: stale,
    });
  }
}
const summary = {
  controller: "matched_scripted_offline",
  modelCalls: 0,
  seed: null,
  repetitions: 1,
  acquisitionTasksPerArm: 1,
  heldOutTasksPerArm: 3,
  liveModelBenefitEstablished: false,
  limitations: [
    "Scripted controller, not stochastic model comparison",
    "Notes and recipes are real implementations; the matched controller still inspects current code",
    "One acquisition example; no recipe promotion threshold or live note-following claim",
    "Fault-injection ablations bypass guards explicitly and are not shipping execution modes",
    "Core mechanism tests separately cover stale approvals, conflicting evidence, corruption and rollback",
    "Elapsed times include harness overhead; no provider latency or billed-token evidence",
  ],
  arms: Object.fromEntries(
    [...new Set(results.map((r) => r.mode))].map((mode) => {
      const r = results.filter(
        (x) => x.mode === mode && x.split === "held_out",
      );
      return [
        mode,
        {
          n: r.length,
          correct: r.filter((x) => x.correct).length,
          harmfulReuse: r.filter((x) => x.harmfulReuse).length,
          staleSideEffects: r.filter((x) => x.staleSideEffect).length,
          unnecessaryInvalidations: r.filter((x) => x.unnecessaryInvalidation)
            .length,
          toolCalls: r.reduce((n, x) => n + x.toolCalls, 0),
          elapsedMs: r.reduce((n, x) => n + x.elapsedMs, 0),
          tokens: 0,
          interventions: 0,
        },
      ];
    }),
  ),
  results,
};
await fs.writeFile(
  path.join(root, "results.json"),
  JSON.stringify(summary, null, 2),
);
console.log(JSON.stringify({ root, arms: summary.arms }, null, 2));
