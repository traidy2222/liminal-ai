import assert from "node:assert/strict";
import test from "node:test";
import {
  countPlanStepsDone,
  isPlanStepDone,
  markPlanStepDone,
  planStepLabel,
} from "./plan_transcript.js";

test("markPlanStepDone prefixes completed steps", () => {
  const steps = ["Research", "Write", "Send"];
  const next = markPlanStepDone(steps, 1);
  assert.equal(next[0], "Research");
  assert.equal(next[1], "✓ Write");
  assert.equal(next[2], "Send");
  assert.equal(countPlanStepsDone(next), 1);
  assert.ok(isPlanStepDone(next[1]!));
  assert.equal(planStepLabel(next[1]!), "Write");
});

test("markPlanStepDone is idempotent", () => {
  const steps = ["✓ A", "B"];
  assert.deepEqual(markPlanStepDone(steps, 0), steps);
});
