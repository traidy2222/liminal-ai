import test from "node:test";
import assert from "node:assert/strict";
import {
  advanceExecutionStateForPlan,
  createDefaultExecutionState,
  estimateComplexityClass,
  estimateContractBounds,
  markExecutionContractStatus,
  renderExecutionStateBlock,
  updateDriftScore,
} from "./execution_state.js";

test("estimateComplexityClass scales with step count", () => {
  assert.equal(estimateComplexityClass(2), "simple");
  assert.equal(estimateComplexityClass(5), "standard");
  assert.equal(estimateComplexityClass(10), "complex");
  assert.equal(estimateComplexityClass(20), "marathon");
});

test("advanceExecutionStateForPlan creates milestones and contracts", () => {
  let state = createDefaultExecutionState("Build feature X");
  state = advanceExecutionStateForPlan(state, ["Read code", "Implement", "Verify"]);
  assert.equal(state.milestones.length, 3);
  assert.equal(state.contracts.length, 3);
  assert.ok(state.activeContractId);
  assert.equal(state.milestones[0]?.status, "doing");
  const bounds = estimateContractBounds(estimateComplexityClass(3));
  assert.equal(state.contracts[0]?.maxToolCalls, bounds.maxToolCalls);
});

test("markExecutionContractStatus updates active contract pointer", () => {
  let state = createDefaultExecutionState("Task");
  state = advanceExecutionStateForPlan(state, ["A", "B"]);
  const secondId = state.contracts[1]!.id;
  state = markExecutionContractStatus(state, secondId, "active");
  assert.equal(state.activeContractId, secondId);
});

test("updateDriftScore clamps to 0..1", () => {
  let state = createDefaultExecutionState("Task");
  state = updateDriftScore(state, 0.5);
  assert.equal(state.driftScore, 0.5);
  state = updateDriftScore(state, 1);
  assert.equal(state.driftScore, 1);
});

test("renderExecutionStateBlock includes mission and drift", () => {
  const state = createDefaultExecutionState("Ship patch");
  const block = renderExecutionStateBlock(state);
  assert.match(block, /Runtime execution state/);
  assert.match(block, /drift_score/);
});
