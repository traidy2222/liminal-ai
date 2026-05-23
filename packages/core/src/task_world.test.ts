import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createTaskWorldSnapshot,
  makeTaskWorldEvidence,
  persistTaskWorldEvent,
  reconstructTaskWorldFromEvents,
  sanitizeTaskWorldId,
  shouldAutoCreateTaskWorld,
  taskWorldDir,
} from "./task_world.js";

test("task world ids are path safe", () => {
  assert.equal(sanitizeTaskWorldId("../../Big Task!?"), "big-task");
  const root = path.join(tmpdir(), "tw-root");
  assert.equal(taskWorldDir("../x", root), path.join(root, ".agent_task_worlds", "x"));
});

test("task world events reconstruct snapshot and skip malformed lines", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "task-world-"));
  try {
    let world = createTaskWorldSnapshot({
      id: "demo",
      objective: "Implement task worlds",
      successCriteria: ["criteria exists"],
      now: 1000,
    });
    world = await persistTaskWorldEvent("demo", null, { type: "created", at: 1000, world }, root);
    world = await persistTaskWorldEvent(
      "demo",
      world,
      { type: "plan_updated", at: 1001, phase: "planning", successCriteria: ["tests pass"] },
      root
    );
    const evidence = makeTaskWorldEvidence({
      claim: "tests pass",
      sourceKind: "command",
      sourceRef: "npm test",
      excerpt: "ok",
      now: 1002,
    });
    world = await persistTaskWorldEvent("demo", world, { type: "evidence_added", at: 1002, entry: evidence }, root);

    const reconstructed = await reconstructTaskWorldFromEvents("demo", root);
    assert.equal(reconstructed?.id, "demo");
    assert.equal(reconstructed?.phase, "planning");
    assert.equal(reconstructed?.verification.successCriteria.length, 2);
    assert.equal(reconstructed?.evidence[0]?.claim, "tests pass");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("task world activation stays quiet for simple turns", () => {
  assert.equal(shouldAutoCreateTaskWorld({ message: "thanks", intent: "general" }), false);
  assert.equal(shouldAutoCreateTaskWorld({ message: "please implement the refactor and test it", intent: "coding" }), true);
});

