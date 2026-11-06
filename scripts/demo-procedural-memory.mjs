#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const root = path.resolve(
  process.argv[2] ??
    path.join(repo, ".agent_artifacts/procedural-memory/demo-" + Date.now()),
);
// Never overwrite an existing demonstration or modify a developer repository.
await fs.mkdir(root);
await fs.mkdir(path.join(root, "repo"));
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
await fs.writeFile(
  path.join(root, "repo/convention.json"),
  JSON.stringify(convention, null, 2),
);
const reports = [];
for (const phase of ["acquire", "reuse", "unrelated", "drift", "repair"]) {
  const child = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      path.join(repo, "packages/eval/src/procedural/demo_worker.ts"),
      root,
      phase,
    ],
    {
      cwd: repo,
      encoding: "utf8",
      windowsHide: true,
      timeout: 90000,
      maxBuffer: 2000000,
    },
  );
  await fs.writeFile(
    path.join(root, phase + ".process.log"),
    child.stdout + child.stderr,
  );
  assert.equal(child.status, 0, child.stderr || child.stdout);
  const report = JSON.parse(
    await fs.readFile(path.join(root, phase + ".result.json"), "utf8"),
  );
  reports.push(report);
  if (["acquire", "repair"].includes(phase))
    assert(report.procedures.some((p) => p.state === "active"));
  if (["reuse", "unrelated"].includes(phase))
    assert.equal(report.finalCorrect, true);
  if (phase === "drift") {
    assert(
      report.procedures.some(
        (p) => p.name === "Register adapter" && p.state === "active",
      ),
      "Unrelated procedure must stay active",
    );
    assert(report.procedures.some((p) => p.state === "needs_revalidation"));
    await assert.rejects(
      fs.stat(path.join(root, "repo/src/providers/stale.json")),
      { code: "ENOENT" },
    );
  }
}
const read = (name) =>
  fs
    .readFile(path.join(root, "repo/src/providers", name + ".json"), "utf8")
    .then(JSON.parse);
assert.deepEqual(await read("maple"), {
  name: "maple",
  symbol: "Maple",
  kind: "provider",
});
assert.deepEqual(await read("birch"), {
  name: "birch",
  symbol: "Birch",
  kind: "provider",
});
assert.deepEqual(
  JSON.parse(
    await fs.readFile(
      path.join(root, "repo/src/extensions/juniper.json"),
      "utf8",
    ),
  ),
  { name: "juniper", symbol: "Juniper", kind: "provider" },
);
assert.equal(
  new Set(reports.map((r) => r.pid)).size,
  5,
  "Every session must be a real process restart",
);
const summary = {
  controller: "scripted_offline",
  modelCalls: 0,
  root,
  checks: {
    acquisition: true,
    freshProcessReuse: true,
    unseenParameters: true,
    unrelatedEditPreserved: true,
    relevantDriftAbstained: true,
    unrelatedProcedureRetained: true,
    newImmutableVersion: true,
    repairedOutcome: true,
  },
  sessions: reports,
};
await fs.writeFile(
  path.join(root, "demo-results.json"),
  JSON.stringify(summary, null, 2),
);
console.log(
  JSON.stringify({ demoPassed: true, root, modelCalls: 0, processes: 5 }),
);
