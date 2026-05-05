import type {
  ExecutionState,
  MilestonePlan,
  MissionPlan,
  RecoveryRecord,
  ExecutionContract,
} from "./types.js";

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

export function advanceExecutionStateForPlan(
  state: ExecutionState,
  steps: string[]
): ExecutionState {
  const now = Date.now();
  const nextMilestones: MilestonePlan[] = [];
  const nextContracts: ExecutionContract[] = [];
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
      maxSteps: 12,
      maxMinutes: 90,
      maxToolCalls: 24,
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

export function renderExecutionStateBlock(state: ExecutionState): string {
  const mission = state.mission
    ? `${state.mission.title} (${state.mission.status})`
    : "(none)";
  const activeContract = state.contracts.find((c) => c.id === state.activeContractId);
  return [
    "## Runtime execution state",
    `mission: ${mission}`,
    `milestones: ${state.milestones.length}`,
    `contracts: ${state.contracts.length}`,
    `active_contract: ${activeContract?.title ?? "(none)"}`,
    `drift_score: ${state.driftScore.toFixed(2)}`,
    `recovery_events: ${state.recoveryLog.length}`,
  ].join("\n");
}
