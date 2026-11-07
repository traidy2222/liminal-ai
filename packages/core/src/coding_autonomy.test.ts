import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCodingTurnInjection } from "./coding_autonomy.js";

test("coding guidance ends at the requested scope without automatic checks", () => {
  const msg = buildCodingTurnInjection({ userMessage: "fix the auth bug in login.ts" });
  assert.match(msg, /CODING TURN/);
  assert.match(msg, /grep_file/);
  assert.match(msg, /do not add a verification pass by default/);
  assert.match(msg, /File currency/);
  assert.doesNotMatch(msg, /auto-runs run_lint/);
});

test("buildCodingTurnInjection respects brief asks", () => {
  const msg = buildCodingTurnInjection({ userMessage: "quick fix the typo in README" });
  assert.match(msg, /Small ask/);
});
