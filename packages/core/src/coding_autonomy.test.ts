import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCodingTurnInjection } from "./coding_autonomy.js";

test("buildCodingTurnInjection emphasizes locate mutate verify", () => {
  const msg = buildCodingTurnInjection({ userMessage: "fix the auth bug in login.ts" });
  assert.match(msg, /CODING TURN/);
  assert.match(msg, /grep_file/);
  assert.match(msg, /run_tests|run_lint/);
  assert.match(msg, /FILE CURRENCY|R-FILE-CURRENCY/);
});

test("buildCodingTurnInjection respects brief asks", () => {
  const msg = buildCodingTurnInjection({ userMessage: "quick fix the typo in README" });
  assert.match(msg, /Small ask/);
});
