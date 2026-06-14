import test from "node:test";
import assert from "node:assert/strict";
import { isRecoverableToolFailure } from "./tool_circuit.js";

test("recoverable recall miss does not count as circuit failure", () => {
  assert.equal(
    isRecoverableToolFailure("recall", {
      ok: false,
      error: 'No note found for key "x". Use search_memory if the key is uncertain.',
    }),
    true
  );
});

test("hard recall errors still count", () => {
  assert.equal(
    isRecoverableToolFailure("recall", { ok: false, error: "notes store corrupt" }),
    false
  );
});

test("read_file ENOENT is recoverable", () => {
  assert.equal(
    isRecoverableToolFailure("read_file", {
      ok: false,
      error: "ENOENT: no such file or directory",
    }),
    true
  );
});
