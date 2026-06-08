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
