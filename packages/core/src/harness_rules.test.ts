import test from "node:test";
import assert from "node:assert/strict";
import {
  buildHarnessRuleRecallMessageForIntent,
  HARNESS_RULES,
} from "./harness_rules.js";

test("buildHarnessRuleRecallMessageForIntent returns compact intent-scoped ids", () => {
  const msg = buildHarnessRuleRecallMessageForIntent("coding", new Map());
  assert.match(msg, /R-READ-ECONOMY/);
  assert.match(msg, /R-GREP-BEFORE-REFACTOR/);
  const idCount = (msg.match(/\*\*R-/g) ?? []).length;
  assert.ok(idCount >= 5 && idCount <= 14);
  assert.ok(!msg.includes("R-RESEARCH-SCOPE"));
});

test("buildHarnessRuleRecallMessageForIntent appends top violation hits", () => {
  const hits = new Map<string, number>([
    ["R-TOOL-RETRY", 9],
    ["R-SCOPE-CREEP", 4],
  ]);
  const msg = buildHarnessRuleRecallMessageForIntent("knowledge", hits);
  assert.match(msg, /R-MEMORY-CONTEXT/);
  assert.match(msg, /R-TOOL-RETRY/);
  for (const id of Object.keys(HARNESS_RULES)) {
    if (msg.includes(`**${id}**`)) continue;
  }
});
