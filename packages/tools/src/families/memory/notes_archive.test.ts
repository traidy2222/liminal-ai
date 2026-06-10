import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtempSync } from "node:fs";

// Isolate global storage BEFORE importing the notes modules so notes.json and
// notes.archive.json land in a throwaway dir (paths are resolved lazily at call
// time from this env var).
process.env["AGENT_GLOBAL_STORAGE_ROOT"] = mkdtempSync(path.join(os.tmpdir(), "liminal-archive-test-"));
process.env["AGENT_STORAGE_LAYOUT"] = "global";
process.env["AGENT_MEMORY_ARCHIVE"] = "1";

const { archiveNotes, listArchive, restoreArchivedNote } = await import("./notes_archive.js");
const { loadRawNotes, atomicUpdate } = await import("./notes_store.js");

function storedNote(value: string) {
  const now = new Date().toISOString();
  return { value, createdAt: now, updatedAt: now, accessCount: 0, confidence: 0.5, scope: "workspace" as const };
}

test("archive → list → restore round-trip", async () => {
  await archiveNotes([{ key: "fact:gone", note: storedNote("the answer is 42"), reason: "forget" }]);

  const listed = await listArchive(10);
  assert.ok(listed.some((r) => r.originalKey === "fact:gone"), "archived note should be listed");

  // Key absent from the store → restore succeeds and re-inserts the value.
  const res = await restoreArchivedNote("fact:gone");
  assert.equal(res.ok, true, res.message);
  const notes = await loadRawNotes();
  assert.ok("fact:gone" in notes, "restored key should be back in the store");

  // And it should be removed from the archive after restore.
  const after = await listArchive(10);
  assert.ok(!after.some((r) => r.originalKey === "fact:gone"), "restored row should leave the archive");
});

test("restore refuses to clobber a live key", async () => {
  await atomicUpdate((n) => ({ ...n, "fact:live": "current value" }));
  await archiveNotes([{ key: "fact:live", note: storedNote("old value"), reason: "forget" }]);
  const res = await restoreArchivedNote("fact:live");
  assert.equal(res.ok, false);
  assert.match(res.message, /already exists/);
});

test("restore of an unknown key reports not found", async () => {
  const res = await restoreArchivedNote("fact:never-existed");
  assert.equal(res.ok, false);
  assert.match(res.message, /No archived note/);
});

test("archiving is a no-op when AGENT_MEMORY_ARCHIVE=0", async () => {
  process.env["AGENT_MEMORY_ARCHIVE"] = "0";
  try {
    const n = await archiveNotes([{ key: "fact:x", note: storedNote("x"), reason: "forget" }]);
    assert.equal(n, 0);
  } finally {
    process.env["AGENT_MEMORY_ARCHIVE"] = "1";
  }
});
