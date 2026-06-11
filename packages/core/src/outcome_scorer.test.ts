import assert from "node:assert/strict";
import { test } from "node:test";
import {
  refineTurnOutcome,
  scoreTurnOutcome,
} from "./outcome_scorer.js";
import { classifyImplicitFollowUpFeedback } from "./input_semantics.js";

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
