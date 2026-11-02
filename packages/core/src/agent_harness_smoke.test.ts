/**
 * Lightweight harness smoke tests — termination and compensation hooks without live LLM.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  CompensationLedger,
  snapshotFileForCompensation,
  inferCompensationAction,
} from "./compensation_ledger.js";
import { HARNESS_ENV_DEFAULTS } from "./harness_default_constants.js";

test("long-horizon reliability defaults (low-overhead subset)", () => {
  assert.equal(HARNESS_ENV_DEFAULTS.AGENT_YIELD_EVERY_N, "4");
  assert.equal(HARNESS_ENV_DEFAULTS.AGENT_MISSION_AUTONOMY, "0");
  assert.equal(HARNESS_ENV_DEFAULTS.AGENT_MISSION_REQUIRES_YOLO, "0");
  assert.equal(HARNESS_ENV_DEFAULTS.AGENT_INTENT_REPO_CONTEXT, "1");
  assert.equal(HARNESS_ENV_DEFAULTS.AGENT_PASTE, "1");
  assert.equal(HARNESS_ENV_DEFAULTS.AGENT_MEMORY_AUTO_EXTRACT, "0");
  assert.equal(HARNESS_ENV_DEFAULTS.AGENT_AUTO_DREAM, "1");
});

test("compensation pre-snapshot + playback restores edited file in workspace", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agent-comp-"));
  const rel = "eval_comp_probe.txt";
  const abs = path.join(root, rel);
  try {
    await writeFile(abs, "before-edit", "utf8");
    const snap = await snapshotFileForCompensation(rel, root);
    assert.equal(snap, "before-edit");

    const ledger = new CompensationLedger();
    ledger.record("mission:test", 1, {
      kind: "restore_file_content",
      path: rel,
      originalContent: snap!,
    });
    await writeFile(abs, "after-edit", "utf8");

    const results = await ledger.playback("mission:test", { workspaceRoot: root });
    assert.equal(results[0]?.ok, true);
    assert.equal(await readFile(abs, "utf8"), "before-edit");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("inferCompensationAction write_file create maps to delete_file", () => {
  const action = inferCompensationAction("write_file", { path: "new.txt", mode: "create" });
  assert.deepEqual(action, { kind: "delete_file", path: "new.txt" });
});
