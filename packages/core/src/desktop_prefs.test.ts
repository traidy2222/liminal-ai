import test from "node:test";
import assert from "node:assert/strict";
import { isBundledRepoPath } from "./desktop_prefs.js";

test("isBundledRepoPath matches explicit repo root", () => {
  assert.equal(isBundledRepoPath("C:\\apps\\liminald\\repo", "C:\\apps\\liminald\\repo"), true);
});

test("isBundledRepoPath matches liminald/repo suffix", () => {
  assert.equal(isBundledRepoPath("C:\\Program Files\\Liminal\\liminald\\repo"), true);
  assert.equal(isBundledRepoPath("/opt/liminal/liminald/repo"), true);
});

test("isBundledRepoPath does not match arbitrary project folders", () => {
  assert.equal(isBundledRepoPath("C:\\Users\\me\\dreamthedream"), false);
});
