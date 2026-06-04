import test from "node:test";
import assert from "node:assert/strict";
import {
  buildIntentInferenceUserContent,
  shouldSkipHarnessSecondaryPassesForTurn,
  parseLikelyEditPathsField,
  resolveMemoryPolicy,
  neutralTurnInferenceResult,
  applyTurnInferenceHeuristics,
  tryHeuristicTurnInference,
  fallbackComplexityForUserMessage,
  buildRoutingProfile,
  type TurnInferenceResult,
} from "./intent_inference.js";

test("tryHeuristicTurnInference matches short greetings only", () => {
  const hi = tryHeuristicTurnInference("hi!");
  assert.ok(hi);
  assert.equal(hi?.intent, "conversational");
  assert.equal(hi?.complexity, "trivial");
  assert.equal(tryHeuristicTurnInference("good evening")?.intent, "conversational");
  assert.equal(tryHeuristicTurnInference("fix the greeting in README"), null);
  assert.equal(tryHeuristicTurnInference("a".repeat(200)), null);
});

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

test("applyTurnInferenceHeuristics trusts LLM buildDeliverable over regex on novel paraphrases", () => {
  // Phrase the old regex wouldn't catch ("whip up", "Socratic dashboard"), but the
  // fast-model classifier handles via paraphrase understanding.
  const llmInference: TurnInferenceResult = {
    ...neutralTurnInferenceResult("test", { intent: "creative" }),
    source: "llm",
    confidence: 0.9,
    buildDeliverable: true,
    implementShip: false,
  };
  const refined = applyTurnInferenceHeuristics(
    "whip up a little Socratic dashboard for me whenever you get a chance",
    llmInference
  );
  assert.equal(refined.intent, "coding", "should override creative→coding from LLM signal");
  assert.equal(refined.toolFirstBias, true);
  assert.equal(refined.essayRisk, true);
  assert.equal(refined.thinkDepth, "brief");
});

test("applyTurnInferenceHeuristics ignores regex when LLM source says buildDeliverable=false", () => {
  // Even though the message contains "build me a tool", the LLM classifier knows
  // this is actually a research question about an existing tool. Trust it.
  const llmInference: TurnInferenceResult = {
    ...neutralTurnInferenceResult("test", { intent: "research" }),
    source: "llm",
    confidence: 0.9,
    buildDeliverable: false,
    implementShip: false,
    freshnessSensitive: true,
  };
  const refined = applyTurnInferenceHeuristics(
    "build me a comparison of which tool is best for X — what's the current consensus",
    llmInference
  );
  // Should NOT flip to coding — research wins because LLM said buildDeliverable=false.
  assert.equal(refined.intent, "research");
});

test("applyTurnInferenceHeuristics falls back to regex when source=default (classifier off/failed)", () => {
  const base = neutralTurnInferenceResult("test", { intent: "knowledge" });
  // source defaults to "default", so regex path fires.
  const refined = applyTurnInferenceHeuristics("build me a html page from scratch", base);
  assert.equal(refined.intent, "coding");
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

// ─── Conversational + creative intents ───────────────────────────────────────

test("resolveMemoryPolicy disables auto-recall for conversational", () => {
  const p = resolveMemoryPolicy("conversational");
  assert.equal(p.allowAutoRecall, false);
  assert.equal(p.scope, "notes");
});

test("resolveMemoryPolicy carves out identity queries even when intent is conversational", () => {
  const p = resolveMemoryPolicy("conversational", { identityQuery: true });
  assert.equal(p.allowAutoRecall, true);
  assert.equal(p.scope, "both");
});

test("resolveMemoryPolicy excludes facts/recipes/trajectories on creative", () => {
  const p = resolveMemoryPolicy("creative");
  assert.equal(p.allowAutoRecall, false);
  assert.deepEqual(p.excludeTypes?.sort(), ["fact", "recipe", "trajectory"]);
});

test("shouldSkipHarnessSecondaryPassesForTurn skips for conversational intent", () => {
  const inf = neutralTurnInferenceResult("test", { intent: "conversational" });
  assert.equal(shouldSkipHarnessSecondaryPassesForTurn("hi", inf), true);
});

test("fallbackComplexityForUserMessage classifies short messages as trivial", () => {
  assert.equal(fallbackComplexityForUserMessage("hi"), "trivial");
  assert.equal(fallbackComplexityForUserMessage("thanks!"), "trivial");
  assert.equal(fallbackComplexityForUserMessage(""), "trivial");
});

test("fallbackComplexityForUserMessage classifies a paragraph as normal", () => {
  const msg = "Please add a new tool family for browser automation and wire it into the registry with a sane default.";
  assert.equal(fallbackComplexityForUserMessage(msg), "normal");
});

test("fallbackComplexityForUserMessage flags long bullet lists as complex", () => {
  const msg = [
    "Refactor the harness with the following:",
    "- split agent.ts",
    "- extract the dispatcher",
    "- move the lock manager out",
    "- migrate the SSE bridge",
    "- update all the tests",
    "- add new docs",
    "- ship the migration script",
  ].join("\n");
  assert.equal(fallbackComplexityForUserMessage(msg), "complex");
});

// ─── Routing profile ─────────────────────────────────────────────────────────

test("buildRoutingProfile returns no-op when AGENT_INTENT_ROUTING is off", () => {
  // AGENT_INTENT_ROUTING defaults to "1" in HARNESS_ENV_DEFAULTS, so deleting
  // the env var falls back to on. Explicitly set "0" to test the disabled path.
  const prev = process.env["AGENT_INTENT_ROUTING"];
  process.env["AGENT_INTENT_ROUTING"] = "0";
  try {
    const inf = neutralTurnInferenceResult("test", { intent: "conversational" });
    const profile = buildRoutingProfile(inf, "main/model");
    assert.equal(profile.applied, false);
    assert.equal(profile.modelSlug, "main/model");
  } finally {
    if (prev === undefined) delete process.env["AGENT_INTENT_ROUTING"];
    else process.env["AGENT_INTENT_ROUTING"] = prev;
  }
});

test("buildRoutingProfile routes conversational to the fast model unconditionally", () => {
  const prev = process.env["AGENT_INTENT_ROUTING"];
  const prevFast = process.env["AGENT_FAST_MODEL"];
  process.env["AGENT_INTENT_ROUTING"] = "1";
  process.env["AGENT_FAST_MODEL"] = "fast/slug";
  try {
    const inf = neutralTurnInferenceResult("test", { intent: "conversational" });
    // intentionally low confidence — conversational should still route fast
    inf.confidence = 0.3;
    inf.source = "llm";
    const profile = buildRoutingProfile(inf, "main/model");
    assert.equal(profile.modelSlug, "fast/slug");
    assert.equal(profile.toolFilterActive, true);
    assert.equal(profile.routingReason, "conversational_always_fast");
  } finally {
    if (prev === undefined) delete process.env["AGENT_INTENT_ROUTING"];
    else process.env["AGENT_INTENT_ROUTING"] = prev;
    if (prevFast === undefined) delete process.env["AGENT_FAST_MODEL"];
    else process.env["AGENT_FAST_MODEL"] = prevFast;
  }
});

test("buildRoutingProfile routes trivial-complexity coding to fast when complexity routing enabled", () => {
  const prev = process.env["AGENT_INTENT_ROUTING"];
  const prevFast = process.env["AGENT_FAST_MODEL"];
  const prevComp = process.env["AGENT_COMPLEXITY_ROUTING"];
  process.env["AGENT_INTENT_ROUTING"] = "1";
  process.env["AGENT_FAST_MODEL"] = "fast/slug";
  process.env["AGENT_COMPLEXITY_ROUTING"] = "1";
  try {
    const inf = neutralTurnInferenceResult("test", { intent: "coding", complexity: "trivial" });
    inf.confidence = 0.95;
    inf.source = "llm";
    const profile = buildRoutingProfile(inf, "main/model");
    assert.equal(profile.modelSlug, "fast/slug");
    assert.match(profile.routingReason, /complexity_trivial_coding/);
  } finally {
    if (prev === undefined) delete process.env["AGENT_INTENT_ROUTING"];
    else process.env["AGENT_INTENT_ROUTING"] = prev;
    if (prevFast === undefined) delete process.env["AGENT_FAST_MODEL"];
    else process.env["AGENT_FAST_MODEL"] = prevFast;
    if (prevComp === undefined) delete process.env["AGENT_COMPLEXITY_ROUTING"];
    else process.env["AGENT_COMPLEXITY_ROUTING"] = prevComp;
  }
});

test("buildRoutingProfile routes high-confidence knowledge to fast when no edit paths", () => {
  const prev = process.env["AGENT_INTENT_ROUTING"];
  process.env["AGENT_INTENT_ROUTING"] = "1";
  try {
    const inf: TurnInferenceResult = {
      ...neutralTurnInferenceResult("test"),
      intent: "knowledge",
      confidence: 0.95,
      source: "llm",
      likelyEditPaths: [],
      freshnessSensitive: false,
    };
    const profile = buildRoutingProfile(inf, "deepseek/deepseek-v4-pro");
    assert.notEqual(profile.modelSlug, "deepseek/deepseek-v4-pro");
    assert.equal(profile.routingReason, "knowledge_high_confidence_fast");
  } finally {
    if (prev === undefined) delete process.env["AGENT_INTENT_ROUTING"];
    else process.env["AGENT_INTENT_ROUTING"] = prev;
  }
});

test("buildRoutingProfile does NOT route trivial creative to fast (generation quality matters)", () => {
  const prev = process.env["AGENT_INTENT_ROUTING"];
  const prevFast = process.env["AGENT_FAST_MODEL"];
  const prevComp = process.env["AGENT_COMPLEXITY_ROUTING"];
  process.env["AGENT_INTENT_ROUTING"] = "1";
  process.env["AGENT_FAST_MODEL"] = "fast/slug";
  process.env["AGENT_COMPLEXITY_ROUTING"] = "1";
  try {
    const inf = neutralTurnInferenceResult("test", { intent: "creative", complexity: "trivial" });
    inf.confidence = 0.95;
    inf.source = "llm";
    const profile = buildRoutingProfile(inf, "main/model");
    assert.equal(profile.modelSlug, "main/model");
  } finally {
    if (prev === undefined) delete process.env["AGENT_INTENT_ROUTING"];
    else process.env["AGENT_INTENT_ROUTING"] = prev;
    if (prevFast === undefined) delete process.env["AGENT_FAST_MODEL"];
    else process.env["AGENT_FAST_MODEL"] = prevFast;
    if (prevComp === undefined) delete process.env["AGENT_COMPLEXITY_ROUTING"];
    else process.env["AGENT_COMPLEXITY_ROUTING"] = prevComp;
  }
});
