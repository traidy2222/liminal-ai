import assert from "node:assert/strict";
import { test } from "node:test";
import {
  refineTurnOutcome,
  scoreTurnOutcome,
  shouldJudgeTurnOutcome,
  buildPendingTurnLearning,
  applyPendingTurnLearning,
} from "./outcome_scorer.js";
import { classifyImplicitFollowUpFeedback } from "./input_semantics.js";
import { shouldAutoExtractMemoriesFromTools } from "./user_identity_memory.js";

test("automatic extraction skips memory-only turns but remains available after actual work", () => {
  for (const names of [[], ["remember"], ["recall_relevant", "remember"], ["search_memory", "memory_query", "think", "check_context"]]) {
    assert.equal(shouldAutoExtractMemoriesFromTools(names), false);
  }
  assert.equal(shouldAutoExtractMemoriesFromTools(["remember", "read_file"]), true);
  assert.equal(shouldAutoExtractMemoriesFromTools(["browser_extract"]), true);
});

test("semantic judging skips routine chat but keeps failures, corrections and substantive work eligible", () => {
  const pending = buildPendingTurnLearning({ processScore: 0.7, intentClass: "knowledge", ruleIds: [],
    userGoal: "Remember a label for this conversation", assistantPreview: "Ready.",
    toolOutcomes: [{ name: "remember", ok: true }], toolsUsed: ["remember"], recipeEligible: false });
  assert.equal(shouldJudgeTurnOutcome(pending, "neutral"), false);
  assert.equal(shouldJudgeTurnOutcome({ ...pending, toolsUsed: [], toolOutcomes: [] }, "thanks"), false);
  assert.equal(shouldJudgeTurnOutcome(pending, "correction"), true);
  assert.equal(shouldJudgeTurnOutcome(pending, "retry"), true);
  assert.equal(shouldJudgeTurnOutcome({ ...pending, toolOutcomes: [{ name: "read_file", ok: false }] }, "neutral"), true);
  assert.equal(shouldJudgeTurnOutcome({ ...pending, toolsUsed: ["read_file", "edit_file"] }, "neutral"), true);
  assert.equal(shouldJudgeTurnOutcome({ ...pending, toolsUsed: ["think", "remember", "search_memory", "check_context"] }, "neutral"), false);
  assert.equal(shouldJudgeTurnOutcome({ ...pending, userGoal: "x".repeat(240), assistantPreview: "y".repeat(300) }, "neutral"), true);
});

test("routine chat makes no remote judge request even with sampling at 100 percent", async () => {
  const keys = ["AGENT_OUTCOME_JUDGE", "AGENT_OUTCOME_JUDGE_SAMPLE_RATE", "AGENT_EFFORT_LEARN"];
  const before = keys.map(key => process.env[key]);
  let calls = 0;
  try {
    process.env.AGENT_OUTCOME_JUDGE = "1"; process.env.AGENT_OUTCOME_JUDGE_SAMPLE_RATE = "1";
    process.env.AGENT_EFFORT_LEARN = "0";
    const pending = buildPendingTurnLearning({ processScore: 0.7, intentClass: "knowledge", ruleIds: [],
      userGoal: "Repeat the previous answer", assistantPreview: "Amber.", toolOutcomes: [], toolsUsed: [], recipeEligible: false });
    const result = await applyPendingTurnLearning({ pending, followUpMessage: "Next question",
      client: { chat: { completions: { create: async () => { calls++; throw Error("Unexpected judge request"); } } } } as any });
    assert.equal(calls, 0); assert.equal(result.judgeScore, null);
  } finally { keys.forEach((key, i) => { if (before[i] === undefined) delete process.env[key]; else process.env[key] = before[i]; }); }
});

test("scoreTurnOutcome rewards tool success", () => {
  const high = scoreTurnOutcome({
    toolsUsed: [
      { name: "read_file", ok: true },
      { name: "edit_file", ok: true },
    ],
    roundCount: 2,
    criticPassed: null,
    contradictionCount: 0,
    terminationReason: "ok",
  });
  const low = scoreTurnOutcome({
    toolsUsed: [
      { name: "read_file", ok: true },
      { name: "edit_file", ok: false },
    ],
    roundCount: 2,
    criticPassed: null,
    contradictionCount: 0,
    terminationReason: "ok",
  });
  assert.ok(high > low);
});

test("classifyImplicitFollowUpFeedback detects correction and thanks", () => {
  assert.equal(classifyImplicitFollowUpFeedback("No, I meant the other file").kind, "correction");
  assert.equal(classifyImplicitFollowUpFeedback("try again please").kind, "retry");
  assert.equal(classifyImplicitFollowUpFeedback("thanks, perfect!").kind, "thanks");
  assert.equal(classifyImplicitFollowUpFeedback("btw what's the weather").kind, "topic_change");
  assert.equal(classifyImplicitFollowUpFeedback("add logging to the handler").kind, "neutral");
});

test("refineTurnOutcome pulls score down on correction", () => {
  const process = 0.92;
  const refined = refineTurnOutcome({
    processScore: process,
    implicitKind: "correction",
    implicitScore: 0.12,
    judgeScore: null,
  });
  assert.ok(refined.effectiveScore < process);
  assert.ok(refined.effectiveScore < 0.4);
});

test("refineTurnOutcome lifts score on thanks", () => {
  const process = 0.55;
  const refined = refineTurnOutcome({
    processScore: process,
    implicitKind: "thanks",
    implicitScore: 0.88,
    judgeScore: null,
  });
  assert.ok(refined.effectiveScore > process);
});

test("refineTurnOutcome blends judge when sampled", () => {
  const refined = refineTurnOutcome({
    processScore: 0.9,
    implicitKind: "neutral",
    implicitScore: null,
    judgeScore: 0.2,
  });
  assert.ok(refined.effectiveScore < 0.9);
  assert.ok(refined.effectiveScore > 0.2);
});
