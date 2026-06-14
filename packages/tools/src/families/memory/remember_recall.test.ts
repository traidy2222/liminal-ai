import test from "node:test";
import assert from "node:assert/strict";
import { resolveRecallStorageKey } from "./remember_recall.js";

test("resolveRecallStorageKey matches typed keys", () => {
  const notes = { "fact:sandbox-lab-token": "SANDBOX_OK" };
  assert.equal(resolveRecallStorageKey(notes, "sandbox-lab-token"), "fact:sandbox-lab-token");
  assert.equal(resolveRecallStorageKey(notes, "fact:sandbox-lab-token"), "fact:sandbox-lab-token");
  assert.equal(resolveRecallStorageKey(notes, "missing"), null);
});

test("resolveRecallStorageKey rejects ambiguous suffix matches", () => {
  const notes = {
    "fact:token": "a",
    "recipe:token": "b",
  };
  assert.equal(resolveRecallStorageKey(notes, "token"), null);
});
