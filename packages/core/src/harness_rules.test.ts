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

test("legacy lookup includes its definitions and excludes unrelated violations",()=>{
 const msg=buildHarnessRuleRecallMessageForIntent("conversational",new Map([["R-EMAIL-PRIVACY",99],["R-AGENTCARD",100]]));
 assert.doesNotMatch(msg,/R-EMAIL|R-AGENTCARD|Full text for each ID/);
 assert.match(msg,/OPTIONAL LEGACY RULE CATALOG/);
});
