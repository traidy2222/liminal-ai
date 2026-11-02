import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bumpFileRevision,
  buildEditStaleRecoveryMessage,
  buildFileRevisionBatchNotice,
  isEditStaleFailure,
  normalizeFilePathKey,
} from "./file_edit_currency.js";

test("normalizeFilePathKey is case-insensitive", () => {
  assert.equal(normalizeFilePathKey("Foo\\Bar.ts"), "foo/bar.ts");
});

test("bumpFileRevision increments per path", () => {
  const m = new Map<string, number>();
  assert.equal(bumpFileRevision(m, "src/a.ts"), 1);
  assert.equal(bumpFileRevision(m, "src/a.ts"), 2);
  assert.equal(bumpFileRevision(m, "src/b.ts"), 1);
});

test("isEditStaleFailure detects mismatch patterns", () => {
  assert.equal(isEditStaleFailure("No changes (0 matches across all pairs)"), true);
  assert.equal(isEditStaleFailure("Context mismatch — could not find"), true);
  assert.equal(isEditStaleFailure("ENOENT: no such file"), false);
});

test("buildFileRevisionBatchNotice lists stale warning", () => {
  const msg = buildFileRevisionBatchNotice([{ path: "pkg/a.ts", rev: 1 }]);
  assert.match(msg, /FILE REVISION/);
  assert.match(msg, /pkg\/a\.ts/);
  assert.match(msg, /STALE/);
});

test("buildEditStaleRecoveryMessage mentions grep", () => {
  const msg = buildEditStaleRecoveryMessage("x.ts", 2);
  assert.match(msg, /grep_file/);
  assert.match(msg, /2 time/);
});
