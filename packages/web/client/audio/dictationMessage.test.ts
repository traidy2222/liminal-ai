import test from "node:test";
import assert from "node:assert/strict";
import { dictationMessage } from "./dictationMessage.js";

test("send uses the complete final transcript instead of a stale partial preview", () => {
  assert.equal(dictationMessage("Please: get the we", 8, 10, "get the weather in Brisbane"), "Please: get the weather in Brisbane");
  assert.equal(dictationMessage("incomplete", 0, 10, "A completely corrected sentence."), "A completely corrected sentence.");
});
test("typed text around the dictation span survives refinement", () => {
  assert.equal(dictationMessage("Please draft wrong words tomorrow", 13, 11, "a reply"), "Please draft a reply tomorrow");
});
