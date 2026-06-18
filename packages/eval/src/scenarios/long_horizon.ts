/**
 * Long-horizon capability evals:
 * multi-stage plans, continuity across rounds, orchestration, critics, and memory reuse.
 *
 * These are intentionally heavier than smoke/canary tests and may take longer to run.
 */
import type { Scenario, TraceEvent } from "../runner.js";
import {
  traceCollectTextBlob,
  traceHasOrderedTools,
  traceHasTool,
  traceTerminatedCleanly,
  traceToolRanOk,
  traceToolResults,
} from "../runner.js";

function distinctTools(trace: TraceEvent[]): number {
  return new Set(
    trace
      .filter((e) => e.type === "tool_result")
      .map((e) => (e.payload as { name?: string }).name)
      .filter((x): x is string => typeof x === "string")
  ).size;
}

export const lhPlanMemoryCodeCritic: Scenario = {
  name: "long-horizon-plan-memory-code-critic",
  tags: ["slow", "critic", "retrieval"],
  maxRounds: 26,
  passAtK: 2,
  env: {
    AGENT_CRITIC_REQUIRE: "1",
    AGENT_CRITIC_EVIDENCE: "1",
    AGENT_CRITIC_MIN_TOOLS: "3",
    AGENT_VERIFY_TOOLS: "1",
  },
  userMessage:
    "This is a 6-step task: " +
    "1) Call plan with >=6 explicit steps. " +
    "2) remember fact:lh_goal and fact:lh_constraint. " +
    "3) run memory_query mode=hybrid for 'goal constraint harness'. " +
    "4) read_file packages/core/src/agent.ts and packages/core/src/dispatcher.ts. " +
    "5) run symbol_index for packages/core and find_references for AgentHarness. " +
    "6) Give a concise final assessment with at least two cited paths.",
  assertions: [
    { name: "plan ran", check: (t) => traceToolRanOk(t, "plan") },
    { name: "memory write ran", check: (t) => traceToolRanOk(t, "remember") },
    { name: "memory query ran", check: (t) => traceToolRanOk(t, "memory_query") },
    { name: "read_file ran", check: (t) => traceToolRanOk(t, "read_file") },
    { name: "verify_result ran", check: (t) => traceToolRanOk(t, "verify_result") },
    {
      name: "high tool diversity",
      check: (t) => distinctTools(t) >= 6,
    },
    { name: "clean termination", check: (t) => traceTerminatedCleanly(t) },
  ],
};

export const lhOrchestrationMergeVerify: Scenario = {
  name: "long-horizon-orchestration-merge-verify",
  tags: ["slow", "critic"],
  maxRounds: 28,
  userMessage:
    "Run a long orchestration loop: " +
    "spawn two child agents with different goals. " +
    "Child A: inspect packages/core/src/context.ts and summarize compression behavior. " +
    "Child B: inspect packages/tools/src/systemPrompt.ts and summarize named rule behavior. " +
    "Then wait_for_agents using returned task IDs, merge the two findings, and verify_result before final answer.",
  assertions: [
    { name: "spawn agent ok", check: (t) => traceToolRanOk(t, "spawn_agent") },
    { name: "wait for agents ok", check: (t) => traceToolRanOk(t, "wait_for_agents") },
    { name: "verify result ok", check: (t) => traceToolRanOk(t, "verify_result") },
    { name: "clean termination", check: (t) => traceTerminatedCleanly(t) },
  ],
};

export const lhDistillArtifactContinuation: Scenario = {
  name: "long-horizon-distill-artifact-continuation",
  tags: ["slow", "retrieval"],
  maxRounds: 24,
  env: { AGENT_DISTILL: "1" },
  userMessage:
    "Do this sequence: " +
    "read_file packages/core/src/agent.ts; if distilled output contains NEXT_ACTIONS_JSON with read_artifact hash, call read_artifact; " +
    "then run memory_query lexical for 'critic gate tool dedup'; finally report 3 bullet findings.",
  assertions: [
    { name: "read_file ok", check: (t) => traceToolRanOk(t, "read_file") },
    {
      name: "artifact handoff path",
      check: (t) => {
        const blob = traceCollectTextBlob(t);
        // permissive: allow runs where distillation threshold did not trigger.
        return blob.includes("NEXT_ACTIONS_JSON") ? traceHasTool(t, "read_artifact") : true;
      },
    },
    { name: "memory_query ok", check: (t) => traceToolRanOk(t, "memory_query") },
    { name: "clean termination", check: (t) => traceTerminatedCleanly(t) },
  ],
};

export const lhContextBudgetDiscipline: Scenario = {
  name: "long-horizon-context-budget-discipline",
  tags: ["slow"],
  maxRounds: 22,
  userMessage:
    `${"Long background context ".repeat(900)}\n` +
    "Under pressure: call check_context early, call compress_context if needed, then continue with repo_map scope packages and one read_file. " +
    "End with one short paragraph.",
  assertions: [
    { name: "check_context ran", check: (t) => traceHasTool(t, "check_context") },
    {
      name: "context managed",
      check: (t) => traceHasTool(t, "compress_context") || traceTerminatedCleanly(t),
    },
    { name: "repo_map ok", check: (t) => traceToolRanOk(t, "repo_map") },
    { name: "read_file ok", check: (t) => traceToolRanOk(t, "read_file") },
    { name: "clean termination", check: (t) => traceTerminatedCleanly(t) },
    {
      name: "runtime heartbeat present",
      check: (t) => t.some((e) => e.type === "runtime_heartbeat"),
    },
  ],
};

export const lhCriticSuiteCoverage: Scenario = {
  name: "long-horizon-critic-suite-coverage",
  tags: ["slow", "critic"],
  maxRounds: 24,
  userMessage:
    "Use repo_map and read_file on packages/core/src/agent.ts to craft a short implementation summary, " +
    "then run evidence_critic, path_critic, and policy_critic over your draft and provide a revised final.",
  env: { AGENT_VERIFY_TOOLS: "1" },
  assertions: [
    { name: "evidence_critic ran", check: (t) => traceHasTool(t, "evidence_critic") },
    { name: "path_critic ran", check: (t) => traceHasTool(t, "path_critic") },
    { name: "policy_critic ran", check: (t) => traceHasTool(t, "policy_critic") },
    { name: "clean termination", check: (t) => traceTerminatedCleanly(t) },
  ],
};

export const lhCodeOpsLoop: Scenario = {
  name: "long-horizon-code-ops-loop",
  tags: ["slow", "retrieval"],
  maxRounds: 26,
  userMessage:
    "Run a long code-ops loop without changing files: " +
    "symbol_index in packages/core, find_references for ContextManager, ast_grep for 'forceCompress', run_lint tsc on packages/core tsconfig, then summarize issues or confirm clean state.",
  assertions: [
    { name: "symbol_index ok", check: (t) => traceToolRanOk(t, "symbol_index") },
    { name: "find_references ok", check: (t) => traceToolRanOk(t, "find_references") },
    { name: "ast_grep invoked", check: (t) => traceHasTool(t, "ast_grep") },
    { name: "run_lint invoked", check: (t) => traceHasTool(t, "run_lint") },
    { name: "clean termination", check: (t) => traceTerminatedCleanly(t) },
  ],
};

export const lhOrderedProtocolCompliance: Scenario = {
  name: "long-horizon-ordered-protocol-compliance",
  tags: ["slow", "retrieval"],
  maxRounds: 24,
  env: { AGENT_VERIFY_TOOLS: "1" },
  userMessage:
    "Strictly follow this order: think -> plan -> remember -> memory_query -> repo_map -> read_file -> verify_result -> final answer. " +
    "Do not skip any stage.",
  assertions: [
    { name: "think before plan", check: (t) => traceHasOrderedTools(t, "think", "plan") },
    { name: "plan before remember", check: (t) => traceHasOrderedTools(t, "plan", "remember") },
    { name: "remember before memory_query", check: (t) => traceHasOrderedTools(t, "remember", "memory_query") },
    { name: "memory_query before read_file", check: (t) => traceHasOrderedTools(t, "memory_query", "read_file") },
    { name: "verify_result executed", check: (t) => traceHasTool(t, "verify_result") },
    { name: "clean termination", check: (t) => traceTerminatedCleanly(t) },
  ],
};

export const lhMemoryContinuityAcrossRound: Scenario = {
  name: "long-horizon-memory-continuity-across-rounds",
  tags: ["retrieval", "slow"],
  maxRounds: 26,
  passAtK: 2,
  userMessage:
    "Phase A: remember three facts with keys lh_a, lh_b, lh_c and type=fact. " +
    "Phase B: query memory_query mode=type memory_type=fact and memory_query mode=graph seed='fact:lh_a'. " +
    "Phase C: produce a compact synthesis that references at least two of those keys.",
  assertions: [
    {
      name: "remember at least three successful calls",
      check: (t) => traceToolResults(t, "remember").filter((r) => r.result.ok).length >= 3,
    },
    { name: "memory_query used", check: (t) => traceHasTool(t, "memory_query") },
    { name: "clean termination", check: (t) => traceTerminatedCleanly(t) },
    {
      name: "execution state emitted",
      check: (t) => t.some((e) => e.type === "execution_state"),
    },
  ],
};

export const lhVaultGrowthAndReuse: Scenario = {
  name: "long-horizon-vault-growth-and-reuse",
  tags: ["slow", "retrieval"],
  maxRounds: 24,
  env: {
    AGENT_VAULT_AUTO_WRITE: "aggressive",
    AGENT_VAULT_DEDUPE: "1",
  },
  userMessage:
    "Research and summarize how context compression and tool dedup work, then write durable wiki knowledge " +
    "using vault_write with links. Reuse vault by searching before writing.",
  assertions: [
    { name: "vault search used", check: (t) => traceHasTool(t, "vault_search") },
    { name: "vault write attempted", check: (t) => traceHasTool(t, "vault_write") },
    {
      name: "vault activity observed",
      check: (t) => t.some((e) => e.type === "vault_activity"),
    },
    { name: "clean termination", check: (t) => traceTerminatedCleanly(t) },
  ],
};

export const lhResearchSynthesisChecklist: Scenario = {
  name: "long-horizon-research-synthesis-checklist",
  tags: ["slow", "retrieval"],
  maxRounds: 20,
  timeoutMs: 100_000,
  userMessage:
    "Do a brief research-style synthesis using web_search/web_fetch. " +
    "Final answer must include a short timeline, multiple source references, uncertainty note, and unresolved item.",
  assertions: [
    { name: "web_search used", check: (t) => traceHasTool(t, "web_search") },
    {
      name: "final text has timeline + uncertainty + unresolved",
      check: (t) => {
        const blob = traceCollectTextBlob(t).toLowerCase();
        const hasTimeline = /timeline|sequence|earlier|recently/.test(blob);
        const hasUncertainty = /uncertain|fragile|developing|confidence/.test(blob);
        const hasUnresolved = /unresolved|unknown|to confirm|not yet clear/.test(blob);
        return hasTimeline && hasUncertainty && hasUnresolved;
      },
    },
    { name: "clean termination", check: (t) => traceTerminatedCleanly(t) },
  ],
};

export const lhStreamCleanlinessScenario: Scenario = {
  name: "long-horizon-stream-cleanliness",
  tags: ["slow"],
  maxRounds: 12,
  timeoutMs: 70_000,
  userMessage:
    "Think step-by-step for a short task, use one tool, then provide a concise answer.",
  assertions: [
    {
      name: "no malformed stream glyphs in transcript",
      check: (t) => {
        const blob = traceCollectTextBlob(t);
        return !/[A-Za-z]⚙[A-Za-z]|�/.test(blob);
      },
    },
    { name: "clean termination", check: (t) => traceTerminatedCleanly(t) },
  ],
};

export const lhDependencyAndHandoffQuality: Scenario = {
  name: "long-horizon-dependency-and-handoff-quality",
  tags: ["slow", "critic"],
  maxRounds: 28,
  userMessage:
    "Spawn task A to summarize packages/core/src/context.ts, then spawn task B with depends_on=[A] to refine A's output into a final checklist. " +
    "Wait for both tasks and provide a merged final answer.",
  assertions: [
    { name: "spawn used", check: (t) => traceHasTool(t, "spawn_agent") },
    { name: "wait used", check: (t) => traceHasTool(t, "wait_for_agents") },
    {
      name: "handoff writes observed",
      check: (t) => t.some((e) => e.type === "subtask_handoff_written"),
    },
    {
      name: "no dependency violation",
      check: (t) => !t.some((e) => e.type === "spawn_contract_violation"),
    },
    { name: "clean termination", check: (t) => traceTerminatedCleanly(t) },
  ],
};

export const LONG_HORIZON_SCENARIOS: Scenario[] = [
  lhPlanMemoryCodeCritic,
  lhOrchestrationMergeVerify,
  lhDistillArtifactContinuation,
  lhContextBudgetDiscipline,
  lhCriticSuiteCoverage,
  lhCodeOpsLoop,
  lhOrderedProtocolCompliance,
  lhMemoryContinuityAcrossRound,
  lhVaultGrowthAndReuse,
  lhResearchSynthesisChecklist,
  lhStreamCleanlinessScenario,
  lhDependencyAndHandoffQuality,
];

