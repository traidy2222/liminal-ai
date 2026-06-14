import type {
  ExecutionState,
  MilestonePlan,
  MissionPlan,
  RecoveryRecord,
  ExecutionContract,
} from "./types.js";
import { CompensationLedger, type CompensationAction } from "./compensation_ledger.js";

export function createDefaultExecutionState(goal: string): ExecutionState {
  const mission: MissionPlan = {
    id: `mission:${Date.now()}`,
    title: "Primary mission",
    objective: goal.slice(0, 2000),
    horizon: "long",
    status: "active",
    milestoneIds: [],
  };
  return {
    version: 1,
    mission,
    milestones: [],
    contracts: [],
    commitments: [],
    worldFacts: [],
    intentFacts: [goal.slice(0, 1000)],
    unresolvedQuestions: [],
    driftScore: 0,
    checkpoints: {
      consecutiveFailures: 0,
    },
    recoveryLog: [],
  };
}

export type ComplexityClass = "simple" | "standard" | "complex" | "marathon";

/** Derive complexity class from plan step count. */
export function estimateComplexityClass(stepCount: number): ComplexityClass {
  if (stepCount <= 2) return "simple";
  if (stepCount <= 5) return "standard";
  if (stepCount <= 10) return "complex";
  return "marathon";
}

/** Dynamic contract bounds — scale with complexity so a 2-step refactor and a
 *  30-step research task don't share the same ceiling. */
export function estimateContractBounds(complexity: ComplexityClass): {
  maxSteps: number;
  maxMinutes: number;
  maxToolCalls: number;
} {
  switch (complexity) {
    case "simple":   return { maxSteps: 6,  maxMinutes: 20,  maxToolCalls: 12 };
    case "standard": return { maxSteps: 16, maxMinutes: 60,  maxToolCalls: 32 };
    case "complex":  return { maxSteps: 32, maxMinutes: 150, maxToolCalls: 64 };
    case "marathon": return { maxSteps: 60, maxMinutes: 300, maxToolCalls: 120 };
  }
}

export function advanceExecutionStateForPlan(
  state: ExecutionState,
  steps: string[]
): ExecutionState {
  const now = Date.now();
  const nextMilestones: MilestonePlan[] = [];
  const nextContracts: ExecutionContract[] = [];
  const complexity = estimateComplexityClass(steps.length);
  const bounds = estimateContractBounds(complexity);
  for (let i = 0; i < steps.length; i++) {
    const id = `m:${now}:${i}`;
    const cid = `c:${now}:${i}`;
    nextMilestones.push({
      id,
      title: `Milestone ${i + 1}`,
      objective: steps[i]!.slice(0, 800),
      status: i === 0 ? "doing" : "todo",
      contractIds: [cid],
    });
    nextContracts.push({
      id: cid,
      title: `Contract ${i + 1}`,
      objective: steps[i]!.slice(0, 800),
      successCriteria: [`Complete: ${steps[i]!.slice(0, 200)}`],
      maxSteps: bounds.maxSteps,
      maxMinutes: bounds.maxMinutes,
      maxToolCalls: bounds.maxToolCalls,
      status: i === 0 ? "active" : "planned",
      startedAt: i === 0 ? now : undefined,
    });
  }
  return {
    ...state,
    milestones: nextMilestones,
    contracts: nextContracts,
    activeContractId: nextContracts[0]?.id,
    mission: state.mission
      ? { ...state.mission, milestoneIds: nextMilestones.map((m) => m.id) }
      : state.mission,
    lastReplanAt: now,
  };
}

export function markExecutionContractStatus(
  state: ExecutionState,
  contractId: string,
  status: ExecutionContract["status"]
): ExecutionState {
  const now = Date.now();
  const contracts = state.contracts.map((c) =>
    c.id === contractId
      ? {
          ...c,
          status,
          ...(status === "active" && !c.startedAt ? { startedAt: now } : {}),
          ...(status === "verified" || status === "failed" || status === "cancelled"
            ? { completedAt: now }
            : {}),
        }
      : c
  );
  const activeContractId =
    status === "active"
      ? contractId
      : state.activeContractId === contractId
        ? contracts.find((c) => c.status === "active" || c.status === "planned")?.id
        : state.activeContractId;
  return { ...state, contracts, activeContractId };
}

export function appendRecoveryRecord(
  state: ExecutionState,
  recovery: RecoveryRecord
): ExecutionState {
  return {
    ...state,
    recoveryLog: [...state.recoveryLog, recovery].slice(-40),
  };
}

export function updateDriftScore(
  state: ExecutionState,
  delta: number
): ExecutionState {
  return {
    ...state,
    driftScore: Math.max(0, Math.min(1, state.driftScore + delta)),
  };
}

/** Per-plan compensation ledger singleton — shared across the harness lifetime. */
const _globalLedger = new CompensationLedger();

export function getCompensationLedger(): CompensationLedger {
  return _globalLedger;
}

export function recordCompensation(planId: string, stepIndex: number, action: CompensationAction): void {
  _globalLedger.record(planId, stepIndex, action);
}

export function commitCompensationPath(planId: string, filePath: string): void {
  _globalLedger.commitPath(planId, filePath);
}

export function renderExecutionStateBlock(state: ExecutionState): string {
  const mission = state.mission
    ? `${state.mission.title}: ${state.mission.objective.slice(0, 120)} (${state.mission.status})`
    : "(none)";
  const activeContract = state.contracts.find((c) => c.id === state.activeContractId);
  const nextMilestone = state.milestones.find((m) => m.status === "todo" || m.status === "doing");
  const openQuestions =
    state.unresolvedQuestions.length > 0
      ? state.unresolvedQuestions.slice(0, 2).join(" · ")
      : "(none)";
  return [
    "## Runtime execution state",
    `mission: ${mission}`,
    `active_contract: ${activeContract?.objective?.slice(0, 120) ?? "(none)"}`,
    activeContract
      ? `budget: tools≤${activeContract.maxToolCalls} rounds≤${activeContract.maxSteps} min≤${activeContract.maxMinutes}`
      : "",
    `next_milestone: ${nextMilestone?.objective?.slice(0, 100) ?? "(none)"}`,
    `drift_score: ${state.driftScore.toFixed(2)}`,
    `open_questions: ${openQuestions}`,
  ]
    .filter(Boolean)
    .join("\n");
}
