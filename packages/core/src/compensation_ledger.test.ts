import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  CompensationLedger,
  formatCompensationReport,
  inferCompensationAction,
  snapshotFileForCompensation,
} from "./compensation_ledger.js";

test("CompensationLedger records and clears plan entries", () => {
  const ledger = new CompensationLedger();
  ledger.record("plan-a", 0, { kind: "delete_file", path: "/tmp/x.txt" });
  ledger.record("plan-a", 1, { kind: "delete_file", path: "/tmp/y.txt" });
  assert.equal(ledger.entriesForPlan("plan-a").length, 2);
  ledger.clear("plan-a");
  assert.equal(ledger.entriesForPlan("plan-a").length, 0);
});

test("inferCompensationAction maps write_file create to delete_file", () => {
  const action = inferCompensationAction("write_file", { path: "foo.ts", mode: "create" });
  assert.deepEqual(action, { kind: "delete_file", path: "foo.ts" });
});

test("playback restores file content", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "comp-ledger-"));
  const filePath = path.join(root, "restore-me.txt");
  try {
    await writeFile(filePath, "original", "utf8");
    const ledger = new CompensationLedger();
    ledger.record("p1", 0, { kind: "restore_file_content", path: filePath, originalContent: "original" });
    await writeFile(filePath, "broken", "utf8");
    const results = await ledger.playback("p1");
    assert.equal(results.length, 1);
    assert.equal(results[0]?.ok, true);
    assert.equal(await readFile(filePath, "utf8"), "original");
    assert.match(formatCompensationReport(results), /COMPENSATION APPLIED/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("playback scoped to onlyStepIndex leaves other rounds intact", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "comp-scope-"));
  const keepPath = path.join(root, "keep.txt");
  const undoPath = path.join(root, "undo.txt");
  try {
    await writeFile(keepPath, "keep-me", "utf8");
    await writeFile(undoPath, "undo-me", "utf8");
    const ledger = new CompensationLedger();
    ledger.record("p1", 1, { kind: "delete_file", path: keepPath });
    ledger.record("p1", 2, { kind: "delete_file", path: undoPath });
    const results = await ledger.playback("p1", { onlyStepIndex: 2, workspaceRoot: root });
    assert.equal(results.length, 1);
    assert.equal(await readFile(keepPath, "utf8"), "keep-me");
    assert.equal(ledger.entriesForPlan("p1").length, 1);
    assert.equal(ledger.entriesForPlan("p1")[0]?.stepIndex, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("commitPath drops pending undo for a file path", () => {
  const ledger = new CompensationLedger();
  ledger.record("p1", 0, { kind: "delete_file", path: "foo.ts" });
  ledger.record("p1", 0, { kind: "restore_file_content", path: "bar.ts", originalContent: "x" });
  ledger.commitPath("p1", "foo.ts");
  const entries = ledger.entriesForPlan("p1");
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.action.kind, "restore_file_content");
});

test("snapshotFileForCompensation returns null for missing file", async () => {
  const snap = await snapshotFileForCompensation(path.join(tmpdir(), "nonexistent-file-xyz.txt"));
  assert.equal(snap, null);
});

test("snapshotFileForCompensation resolves relative paths against workspace root", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "comp-snap-"));
  try {
    await writeFile(path.join(root, "nested.txt"), "nested-content", "utf8");
    const snap = await snapshotFileForCompensation("nested.txt", root);
    assert.equal(snap, "nested-content");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
