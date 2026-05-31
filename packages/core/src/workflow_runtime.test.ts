import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtempSync } from "node:fs";

// Keep workflow disk writes out of the repo.
process.env["AGENT_WORKSPACE_ROOT"] = mkdtempSync(path.join(os.tmpdir(), "liminal-wf-test-"));

import { WorkflowRuntime, type WorkflowSpawn, type WorkflowVerifyInput } from "./workflow_runtime.js";
import { WorkflowStore } from "./workflow_store.js";
import { parseWorkflowSpec, type WorkflowSpec } from "./workflow_spec.js";
import type { SubtaskResult } from "./types.js";

function spec(raw: unknown): WorkflowSpec {
  const r = parseWorkflowSpec(raw);
  if (!r.ok) throw new Error(r.error);
  return r.spec;
}

const okSub = (taskId: string, output = "done"): SubtaskResult => ({ taskId, ok: true, output, rounds: 1 });

function makeRuntime(opts: {
  spawn: WorkflowSpawn;
  maxConcurrent?: number;
  maxAgents?: number;
  verify?: (i: WorkflowVerifyInput) => Promise<{ ok: boolean; detail: string }>;
  publishContext?: (key: string, summary: string, payload: string) => void;
}) {
  const store = new WorkflowStore(`test_${Math.random().toString(36).slice(2)}`);
  const rt = new WorkflowRuntime({
    spawn: opts.spawn,
    summarize: async (i) => `summary:${i.phase.id}:${i.results.length}`,
    verify: opts.verify,
    publishContext: opts.publishContext,
    store,
    maxConcurrent: opts.maxConcurrent ?? 4,
    maxAgents: opts.maxAgents ?? 64,
  });
  return { rt, store };
}

test("runs phases in dependsOn order and stores every agent result", async () => {
  let n = 0;
  const spawn: WorkflowSpawn = () => {
    const taskId = `t${n++}`;
    return { taskId, promise: Promise.resolve(okSub(taskId)) };
  };
  const { rt, store } = makeRuntime({ spawn });
  const report = await rt.run(
    spec({
      goal: "g",
      phases: [
        { id: "understand", goal: "u", fanOut: { tasks: [{ goal: "a" }, { goal: "b" }] } },
        { id: "execute", goal: "e", dependsOn: ["understand"], fanOut: { tasks: [{ goal: "c" }, { goal: "d" }, { goal: "f" }] } },
      ],
    })
  );
  assert.equal(report.ok, true);
  assert.equal(report.totalAgents, 5);
  assert.deepEqual(report.phases.map((p) => p.phaseId), ["understand", "execute"]);
  assert.equal(store.all().length, 5);
  assert.equal(store.forPhase("understand").length, 2);
});

test("provisions spawned agents with per-phase + planner tool families", async () => {
  const seen: string[][] = [];
  const spawn: WorkflowSpawn = (cfg) => {
    seen.push(cfg.activateFamilies ?? []);
    const taskId = `t${Math.random()}`;
    return { taskId, promise: Promise.resolve(okSub(taskId)) };
  };
  const { rt } = makeRuntime({ spawn });
  await rt.run(
    spec({
      goal: "g",
      phases: [
        // execute kind → defaults files_edit/code_intel/shell; task adds browser
        { id: "build", kind: "execute", goal: "build", fanOut: { tasks: [{ goal: "make page", toolFamilies: ["browser"] }] } },
      ],
    })
  );
  assert.equal(seen.length, 1);
  const fams = new Set(seen[0]);
  for (const f of ["files_edit", "code_intel", "shell", "browser"]) {
    assert.ok(fams.has(f), `spawned agent should have family ${f}; got ${[...fams].join(",")}`);
  }
});

test("research fan-out tasks get web tool activation", async () => {
  const seen: Array<{ families: string[]; tools?: string[] }> = [];
  const spawn: WorkflowSpawn = (cfg) => {
    seen.push({ families: cfg.activateFamilies ?? [], tools: cfg.activateTools });
    const taskId = `t${Math.random()}`;
    return { taskId, promise: Promise.resolve(okSub(taskId)) };
  };
  const { rt } = makeRuntime({ spawn });
  await rt.run(
    spec({
      goal: "market research",
      phases: [
        {
          id: "research",
          kind: "custom",
          goal: "parallel research",
          fanOut: {
            tasks: [{ goal: "Research TAM and competitor pricing for AI therapy notes" }],
          },
        },
      ],
    })
  );
  assert.equal(seen.length, 1);
  assert.ok(seen[0]!.families.includes("web"));
  assert.ok(seen[0]!.tools?.includes("web_search"));
  assert.ok(seen[0]!.tools?.includes("web_fetch"));
});

test("flows prior-phase context downstream: publishes per phase + sets contextBusPrefix for later phases", async () => {
  const published: string[] = [];
  const prefixes: (string | undefined)[] = [];
  const spawn: WorkflowSpawn = (cfg) => {
    prefixes.push(cfg.contextBusPrefix);
    const taskId = `t${Math.random()}`;
    return { taskId, promise: Promise.resolve(okSub(taskId)) };
  };
  const { rt } = makeRuntime({
    spawn,
    publishContext: (key) => published.push(key),
  });
  await rt.run(
    spec({
      goal: "g",
      phases: [
        { id: "understand", kind: "understand", goal: "u", fanOut: { tasks: [{ goal: "a" }] } },
        { id: "execute", kind: "execute", goal: "e", dependsOn: ["understand"], fanOut: { tasks: [{ goal: "b" }] } },
      ],
    })
  );
  // Each phase publishes its bundle under the run's prefix.
  assert.ok(published.some((k) => k.endsWith("/understand")), `published keys: ${published.join(",")}`);
  assert.ok(published.some((k) => k.endsWith("/execute")));
  // The first-phase agent has no upstream; the second-phase agent gets the bus prefix.
  assert.equal(prefixes[0], undefined);
  assert.match(prefixes[1] ?? "", /^ctx\/wf\/.+\/$/);
});

test("respects the concurrency cap within a phase", async () => {
  let active = 0;
  let maxActive = 0;
  const spawn: WorkflowSpawn = () => {
    active++;
    maxActive = Math.max(maxActive, active);
    const taskId = `t${Math.random()}`;
    const promise = new Promise<SubtaskResult>((resolve) =>
      setTimeout(() => {
        active--;
        resolve(okSub(taskId));
      }, 5)
    );
    return { taskId, promise };
  };
  const { rt } = makeRuntime({ spawn, maxConcurrent: 2 });
  await rt.run(spec({ goal: "g", phases: [{ id: "p", goal: "p", fanOut: { tasks: Array.from({ length: 6 }, (_, i) => ({ goal: `t${i}` })) } }] }));
  assert.ok(maxActive <= 2, `maxActive was ${maxActive}, expected ≤ 2`);
});

test("verify→iterate re-runs the phase until it passes, bounded by maxIterations", async () => {
  let waves = 0;
  const spawn: WorkflowSpawn = () => {
    const taskId = `t${Math.random()}`;
    return { taskId, promise: Promise.resolve(okSub(taskId)) };
  };
  // Count fan-out waves via a verify that fails the first time, passes the second.
  let verifyCalls = 0;
  const verify = async () => {
    verifyCalls++;
    return { ok: verifyCalls >= 2, detail: "lint error" };
  };
  // wrap spawn to count waves indirectly: count tasks; 2 tasks/iteration.
  const countingSpawn: WorkflowSpawn = (cfg) => {
    waves++;
    return spawn(cfg);
  };
  const { rt } = makeRuntime({ spawn: countingSpawn, verify });
  const report = await rt.run(
    spec({
      goal: "g",
      phases: [
        {
          id: "fix",
          goal: "fix",
          fanOut: { tasks: [{ goal: "a" }, { goal: "b" }] },
          verify: { gate: "run_lint", onFail: "iterate" },
          converge: { maxIterations: 3 },
        },
      ],
    })
  );
  assert.equal(report.ok, true);
  assert.equal(report.phases[0]!.iterations, 2);
  assert.equal(waves, 4, "2 tasks × 2 iterations = 4 spawns");
});

test("enforces the total agent cap and marks the run truncated", async () => {
  const spawn: WorkflowSpawn = () => {
    const taskId = `t${Math.random()}`;
    return { taskId, promise: Promise.resolve(okSub(taskId)) };
  };
  const { rt, store } = makeRuntime({ spawn, maxAgents: 3 });
  const report = await rt.run(spec({ goal: "g", phases: [{ id: "p", goal: "p", fanOut: { tasks: Array.from({ length: 6 }, (_, i) => ({ goal: `t${i}` })) } }] }));
  assert.equal(report.truncated, true);
  assert.equal(report.totalAgents, 3);
  assert.equal(store.all().length, 3);
});

test("adversarial review spawns an extra reviewer agent", async () => {
  const spawn: WorkflowSpawn = () => {
    const taskId = `t${Math.random()}`;
    return { taskId, promise: Promise.resolve(okSub(taskId, "finding")) };
  };
  const { rt, store } = makeRuntime({ spawn });
  await rt.run(spec({ goal: "g", phases: [{ id: "p", goal: "p", review: "adversarial", fanOut: { tasks: [{ goal: "a" }] } }] }));
  // 1 worker + 1 reviewer
  assert.equal(store.all().length, 2);
  assert.equal(store.all().filter((e) => e.kind === "review").length, 1);
});

test("WorkflowStore BM25 query retrieves the right agent output", async () => {
  const store = new WorkflowStore(`q_${Math.random().toString(36).slice(2)}`);
  await store.add({ phaseId: "p", taskId: "t1", goal: "alpha", ok: true, output: "the deployment uses port 8080 for ingress", at: new Date().toISOString() });
  await store.add({ phaseId: "p", taskId: "t2", goal: "beta", ok: true, output: "the cache is redis on a separate host", at: new Date().toISOString() });
  const hits = store.query("redis cache host", 1);
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.taskId, "t2");
});
