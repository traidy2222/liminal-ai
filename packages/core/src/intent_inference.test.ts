import test from "node:test";
import assert from "node:assert/strict";
import {
  buildIntentInferenceUserContent,
  shouldSkipHarnessSecondaryPassesForTurn,
  parseLikelyEditPathsField,
  resolveMemoryPolicy,
  neutralTurnInferenceResult,
  applyTurnInferenceHeuristics,
} from "./intent_inference.js";

test("parseLikelyEditPathsField caps and normalizes", () => {
  assert.deepEqual(parseLikelyEditPathsField(["a/b.ts", "x\\y.ts", 3, "a/b.ts"], 3), ["a/b.ts", "x/y.ts"]);
  assert.deepEqual(parseLikelyEditPathsField(undefined), []);
});

test("buildIntentInferenceUserContent includes sections and USER_MESSAGE", () => {
  const body = buildIntentInferenceUserContent("fix the bug", {
    epistemicFilesModified: ["packages/core/src/agent.ts"],
    lastAssistantSnippet: "I updated the handler.",
  });
  assert.match(body, /^USER_MESSAGE:\nfix the bug/);
  assert.match(body, /RECENT_FILES_MODIFIED/);
  assert.match(body, /LAST_ASSISTANT_REPLY_SNIPPET/);
});

test("buildIntentInferenceUserContent truncates when maxCharsOverride is small", () => {
  const body = buildIntentInferenceUserContent(
    "hello",
    {
      repoMapLines: Array.from({ length: 40 }, (_, i) => `line-${i}-padding-padding`),
    },
    { maxCharsOverride: 200 }
  );
  assert.ok(body.length <= 280);
  assert.match(body, /intent_context_truncated/);
});

test("shouldSkipHarnessSecondaryPassesForTurn uses LLM flags only", () => {
  const inf = neutralTurnInferenceResult("test");
  // neutral inference has no flags set — should not skip
  assert.equal(shouldSkipHarnessSecondaryPassesForTurn("who are you", inf), false);
  assert.equal(shouldSkipHarnessSecondaryPassesForTurn("run tests", inf), false);

  // LLM-set flags are respected
  assert.equal(
    shouldSkipHarnessSecondaryPassesForTurn("x", { ...inf, skipHarnessSecondaryPasses: true }),
    true
  );
  assert.equal(
    shouldSkipHarnessSecondaryPassesForTurn("x", { ...inf, personaIdentityPrompt: true }),
    true
  );
});

test("resolveMemoryPolicy disables auto recall on exploratory by default", () => {
  const prev = process.env["AGENT_MEMORY_DEBIAS"];
  const prevEx = process.env["AGENT_MEMORY_EXPLORATORY_AUTO_RECALL"];
  process.env["AGENT_MEMORY_DEBIAS"] = "1";
  delete process.env["AGENT_MEMORY_EXPLORATORY_AUTO_RECALL"];
  try {
    const p = resolveMemoryPolicy("knowledge", { exploratoryCreative: true });
    assert.equal(p.allowAutoRecall, false);
  } finally {
    if (prev === undefined) delete process.env["AGENT_MEMORY_DEBIAS"];
    else process.env["AGENT_MEMORY_DEBIAS"] = prev;
    if (prevEx === undefined) delete process.env["AGENT_MEMORY_EXPLORATORY_AUTO_RECALL"];
    else process.env["AGENT_MEMORY_EXPLORATORY_AUTO_RECALL"] = prevEx;
  }
});

test("applyTurnInferenceHeuristics upgrades Iran update to research tool-first", () => {
  const base = neutralTurnInferenceResult("test", { intent: "knowledge", exploratoryCreative: true });
  const refined = applyTurnInferenceHeuristics("update yourself on whats going on with iran", base);
  assert.equal(refined.intent, "research");
  assert.equal(refined.exploratoryCreative, false);
  assert.equal(refined.toolFirstBias, true);
  assert.equal(refined.thinkDepth, "brief");
  assert.ok((refined.reasoningWordBudget ?? 999) <= 140);
});

test("applyTurnInferenceHeuristics upgrades build-for-yourself to coding tool-first", () => {
  const base = neutralTurnInferenceResult("test", { intent: "knowledge", exploratoryCreative: true });
  const refined = applyTurnInferenceHeuristics("build something for yourself", base);
  assert.equal(refined.intent, "coding");
  assert.equal(refined.exploratoryCreative, false);
  assert.equal(refined.toolFirstBias, true);
});

test("resolveMemoryPolicy exploratory still applies when AGENT_MEMORY_DEBIAS=0", () => {
  const prev = process.env["AGENT_MEMORY_DEBIAS"];
  const prevEx = process.env["AGENT_MEMORY_EXPLORATORY_AUTO_RECALL"];
  process.env["AGENT_MEMORY_DEBIAS"] = "0";
  delete process.env["AGENT_MEMORY_EXPLORATORY_AUTO_RECALL"];
  try {
    const p = resolveMemoryPolicy("knowledge", { exploratoryCreative: true });
    assert.equal(p.allowAutoRecall, false);
  } finally {
    if (prev === undefined) delete process.env["AGENT_MEMORY_DEBIAS"];
    else process.env["AGENT_MEMORY_DEBIAS"] = prev;
    if (prevEx === undefined) delete process.env["AGENT_MEMORY_EXPLORATORY_AUTO_RECALL"];
    else process.env["AGENT_MEMORY_EXPLORATORY_AUTO_RECALL"] = prevEx;
  }
});
