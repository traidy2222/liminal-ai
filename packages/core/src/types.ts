import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";
import type { TaskOrchestrator } from "./orchestrator.js";
import type { WorldContextOptions } from "./world_context.js";
import type { RuntimePreferences } from "./runtime_prefs.js";

export type Message = ChatCompletionMessageParam;

// ─── Tool system ──────────────────────────────────────────────────────────────

/** Typed property schema for deep validation (#5). */
export interface PropertySchema {
  type?: string;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  /** For arrays: schema of each element. */
  items?: PropertySchema;
  /** For nested objects. */
  properties?: Record<string, PropertySchema>;
  required?: string[];
  description?: string;
}

export interface ToolParameterSchema {
  type: "object";
  properties: Record<string, PropertySchema>;
  required?: string[];
  additionalProperties?: false;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameterSchema;
  requiresApproval: boolean;
  handler: ToolHandler;
  /**
   * Returns the resource IDs this tool will lock before execution.
   * e.g. `(args) => [\`file:write:\${args.path}\`]`
   * Lock ordering is enforced alphabetically by ResourceLockManager to prevent deadlocks.
   */
  resourceLocks?: (args: Record<string, unknown>) => string[];
  /**
   * Danger level for pre-flight enforcement.
   * "destructive" tools require a think() call in the same round before they execute.
   * "cautious" tools are logged but not blocked.
   * "safe" (default) has no restrictions.
   */
  dangerLevel?: "safe" | "cautious" | "destructive";
  /**
   * If true, the dispatcher caches successful results keyed by (name + argsJson).
   * Only set for idempotent read-only tools (read_file, list_dir, web_search, web_fetch).
   * (#6 Tool Result Memoization)
   */
  cacheable?: boolean;
  /** TTL in ms for cached results. Default: 30_000 if cacheable is true. */
  cacheTtlMs?: number;
}

export type ToolResult =
  | { ok: true; output: string }
  | { ok: false; error: string };

export type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

// ─── Approval ─────────────────────────────────────────────────────────────────

export type ApprovalDecision =
  | { decision: "approve" }
  | { decision: "edit"; editedArgs: Record<string, unknown> }
  | { decision: "reject"; reason: string };

// ─── Streaming accumulation ───────────────────────────────────────────────────

export interface AccumulatedToolCall {
  id: string;
  name: string;
  argsJson: string;
}

export interface StreamChunk {
  textDelta?: string;
  toolCallDelta?: {
    index: number;
    id?: string;
    name?: string;
    argsDelta?: string;
  };
  finishReason?: "stop" | "tool_calls" | "length" | null;
}

// ─── Context window management ────────────────────────────────────────────────

export interface ContextConfig {
  modelMaxTokens: number;
  thresholdFraction: number;
  inceptionMessages: Message[];
  /**
   * How many recent complete rounds to preserve during compression.
   * Default: 6. Configurable per-agent or per-task.
   * (#1 Fix Fallback Masking)
   */
  keepRecentRounds?: number;
  /**
   * Called after any compression fires (auto or manual) with before/after fractions
   * and the number of rounds that were collapsed.
   * (#7 Structured Event Log)
   */
  onCompressed?: (
    beforeFraction: number,
    afterFraction: number,
    roundsCompressed: number
  ) => void;
  /**
   * ACON-style: natural-language compression policy prepended to auto / manual
   * compression summary blocks so the model knows what was preserved vs dropped.
   */
  compressionGuideline?: string;
  /**
   * Appended to inception message[1] (protocol core) each send from registered tool names.
   * Keeps core prompt small; expanded rules only when matching tools exist (e.g. child agents).
   */
  protocolDynamicBuilder?: (toolNames: string[]) => string;
}

export interface ContextSnapshot {
  tokenCount: number;
  maxTokens: number;
  usageFraction: number;
  masked: boolean;
}

/** Structured working snapshot (COMPASS-style); rendered into [WORKING STATE]. */
export interface EpistemicState {
  goal: string;
  subgoals: {
    id: string;
    status: "todo" | "doing" | "done" | "blocked";
    note?: string;
  }[];
  hypotheses: {
    claim: string;
    confidence: "low" | "med" | "high";
    evidence?: string[];
  }[];
  filesTouched: string[];
  lastVerified?: { what: string; how: string; at: number };
  openQuestions: string[];
  budget: { usagePct: number; recallK: number; spareRounds: number };
  /** Last tool batch / outcomes one-liner from harness. */
  harnessNotes?: string;
}

export interface ExecutionContract {
  id: string;
  title: string;
  objective: string;
  successCriteria: string[];
  maxSteps: number;
  maxMinutes: number;
  maxToolCalls: number;
  rollbackPlan?: string;
  allowedTools?: string[];
  status: "planned" | "active" | "verified" | "failed" | "cancelled";
  startedAt?: number;
  completedAt?: number;
}

export interface MilestonePlan {
  id: string;
  title: string;
  objective: string;
  status: "todo" | "doing" | "done" | "blocked";
  contractIds: string[];
}

export interface MissionPlan {
  id: string;
  title: string;
  objective: string;
  horizon: "short" | "mid" | "long";
  status: "planned" | "active" | "done" | "blocked";
  milestoneIds: string[];
}

export interface CommitmentRule {
  id: string;
  label: string;
  rationale: string;
  severity: "low" | "med" | "high";
  scope: "safety" | "architecture" | "quality" | "user_constraint";
  pattern?: string;
  blockedTools?: string[];
}

export interface RecoveryRecord {
  at: number;
  reason: string;
  strategy: "retry" | "replan" | "escalate" | "ask_user";
  notes?: string;
}

export interface ExecutionState {
  version: 1;
  mission: MissionPlan | null;
  milestones: MilestonePlan[];
  contracts: ExecutionContract[];
  activeContractId?: string;
  commitments: CommitmentRule[];
  worldFacts: string[];
  intentFacts: string[];
  unresolvedQuestions: string[];
  driftScore: number;
  lastReplanAt?: number;
  checkpoints: {
    lastSavedAt?: number;
    checkpointId?: string;
    consecutiveFailures: number;
  };
  recoveryLog: RecoveryRecord[];
}

// ─── Multi-agent orchestration ────────────────────────────────────────────────

export interface ChildAgentConfig {
  goal: string;
  /** Restrict to these tool names. undefined = all tools except depth-excluded orchestration. */
  toolNames?: string[];
  /** Extra context prepended to inception messages. */
  additionalContext?: string;
  /** Max ReAct rounds for this child. Defaults to parent's maxToolRoundsPerTurn. */
  maxRounds?: number;
  /** Timeout in ms before the child is auto-cancelled. Default: 300_000 (5 min). */
  timeoutMs?: number;
}

export interface SubtaskResult {
  taskId: string;
  ok: boolean;
  /** Last assistant message text, or error message. */
  output: string;
  rounds: number;
}

/** Why this send() ended (present on reliable turn_end emissions). */
export type TurnEndTerminationReason = "ok" | "round_cap" | "timeout" | "error";

/** Emitted on turn_end for orchestration / eval surfaces (arXiv:2512.08296, 2601.06112). */
export interface TurnEndHarnessMetrics {
  /** How the harness finished this send (optional for backward compatibility). */
  terminationReason?: TurnEndTerminationReason;
  /** Distinct tool names invoked at least once during this send(). */
  toolsInvokedThisSend: string[];
  /** Count of spawn_agent calls in this send(). */
  spawnAgentCallsThisSend: number;
  /** Size of the last completed parallel tool batch (0 if none). */
  parallelToolCallsLastBatch: number;
  /** Truncated [WORKING STATE] block for UIs / eval (optional). */
  workingStatePreview?: string;
  /** Full structured epistemic snapshot at turn end (optional). */
  epistemicState?: EpistemicState;
  /** Structured long-horizon execution state snapshot (optional). */
  executionState?: ExecutionState;
  vaultMetrics?: {
    reads: number;
    searches: number;
    writes: number;
    skippedWrites: number;
  };
}

// ─── Events ───────────────────────────────────────────────────────────────────

export interface AgentEventMap {
  /** Emitted at the start of each root/child send() with the user text (session logging). */
  send_start: { userMessage: string; agentDepth: number };
  /** Assistant-visible stream; `trace` is for harness noise (hidden when AGENT_UI_VERBOSITY=quiet). */
  text: { delta: string; channel?: "user" | "trace" };
  /** Provider transient error; UI may fold instead of chat-stuffing (AGENT_UI_VERBOSITY=quiet). */
  provider_retry: {
    attempt: number;
    maxAttempts: number;
    message: string;
    backoffMs: number;
  };
  tool_start: { callId: string; name: string };
  tool_delta: { callId: string; argsDelta: string };
  tool_approval: {
    callId: string;
    name: string;
    args: Record<string, unknown>;
    /** Wall-clock ms until auto-reject if no human decision (for UI countdown). */
    approvalTimeoutMs: number;
    resolve: (decision: ApprovalDecision) => void;
  };
  tool_result: {
    callId: string;
    name: string;
    args: Record<string, unknown>;
    result: ToolResult;
  };
  ask_user: {
    prompt: string;
    resolve: (answer: string) => void;
  };
  /** Emitted when the user answers an ask_user prompt. (#7 Structured Event Log) */
  ask_user_answered: { prompt: string; answer: string };
  turn_end: {
    contextSnapshot: ContextSnapshot;
    /** Wall-clock time for the entire send() call in ms. */
    durationMs?: number;
    /** MAS / ReliabilityBench-style telemetry for this send() (cumulative where noted). */
    harnessMetrics?: TurnEndHarnessMetrics;
  };
  error: { err: Error };
  subtask_spawned: {
    taskId: string;
    parentTaskId: string;
    goal: string;
    depth: number;
  };
  subtask_complete: {
    taskId: string;
    ok: boolean;
    output: string;
    rounds: number;
  };
  /** Live output delta from a running sub-agent, forwarded to the parent's emitter. */
  subtask_output: {
    taskId: string;
    delta: string;
  };
  /** Emitted after an approval gate is resolved (approve/edit/reject). (#7) */
  approval_decision: {
    callId: string;
    name: string;
    decision: "approve" | "edit" | "reject";
    editedArgs?: Record<string, unknown>;
  };
  /** Advisory safety classifier result before optional human approval. (#safety-judge) */
  safety_check: {
    callId: string;
    name: string;
    source: "heuristic" | "llm" | "cache";
    verdict: "safe" | "require_human";
  };
  /** Emitted when context compression fires (auto or manual). (#7) */
  context_compressed: {
    beforeFraction: number;
    afterFraction: number;
    roundsCompressed: number;
  };
  /** Wall-clock time for a tool handler execution. (#7) */
  tool_timing: { callId: string; name: string; durationMs: number };
  /** Emitted when the agent's persona is changed via set_persona(). */
  persona_changed: { name: string; description: string };
  execution_state: {
    missionId?: string;
    activeContractId?: string;
    driftScore: number;
    milestoneCount: number;
    contractCount: number;
  };
  contract_transition: {
    contractId: string;
    status: ExecutionContract["status"];
    reason?: string;
  };
  contract_violation: {
    contractId?: string;
    toolName: string;
    reason: string;
    severity: "low" | "med" | "high";
  };
  recovery_action: {
    strategy: RecoveryRecord["strategy"];
    reason: string;
    notes?: string;
  };
  drift_detected: {
    score: number;
    reason: string;
    triggeredReplan: boolean;
  };
  runtime_heartbeat: {
    round: number;
    uptimeMs: number;
    activeContractId?: string;
    driftScore: number;
  };
  vault_activity: {
    action: "read" | "search" | "write" | "skip_write";
    ok: boolean;
    noteTitle?: string;
    reason?: string;
  };
  runtime_pref_detected: {
    summary: string;
    risky: boolean;
  };
  runtime_pref_changed: {
    summary: string;
    persisted: boolean;
  };
  runtime_pref_persisted: {
    path: string;
  };
  runtime_pref_rejected: {
    summary: string;
    reason: string;
  };
  recency_check: {
    required: boolean;
    passed: boolean;
    reason: string;
    attemptedRecovery: boolean;
  };
}

export type AgentEventName = keyof AgentEventMap;

// ─── Persona ──────────────────────────────────────────────────────────────────

/**
 * Persona configuration — defines the agent's name, identity, and communication style.
 * Changes tone and vocabulary only; operational protocols are immutable.
 */
/** Optional LLM + heuristic gate to skip user approval for clearly safe calls. */
export interface AgentSafetyJudgeOptions {
  enabled: boolean;
  /** Model slug for the 0/1 classifier (defaults to harness `model`). */
  model?: string;
  /** LLM call timeout in ms. Default 4000. */
  timeoutMs?: number;
  /** In-process verdict cache TTL in ms. Default 300_000. */
  cacheTtlMs?: number;
  /**
   * When true, classifier errors/unknown parse → treat as safe (skip approval).
   * Default false (fail closed → require human).
   */
  failOpen?: boolean;
}

export interface PersonaConfig {
  /** Display name shown in UI (e.g. "JARVIS", "Liminal"). */
  name: string;
  /** One-sentence description of the agent's character. */
  description: string;
  /** 2-4 sentences describing HOW to speak: phrasing, tone, sentence style. */
  voice?: string;
  /** Short one-word personality descriptors (e.g. ["formal", "dry wit"]). */
  traits?: string[];
}

// ─── Agent config ─────────────────────────────────────────────────────────────

export interface AgentConfig {
  openRouterApiKey: string;
  model: string;
  baseURL: string;
  context: ContextConfig;
  maxToolRoundsPerTurn: number;
  /** Max retries on transient provider errors (default: 3) */
  maxRetries?: number;
  /** Base delay in ms between retries — doubles each attempt (default: 1500) */
  retryDelayMs?: number;
  /**
   * Max retries specifically for provider rate-limit failures (429).
   * Default: 120. Higher values allow much longer persistence under throttling.
   */
  maxRateLimitRetries?: number;
  /**
   * Max retries for transient provider-unavailable/server failures (5xx, bad gateway).
   * Default: 60.
   */
  maxTransient5xxRetries?: number;
  /** Shared orchestrator instance. Root creates one; children receive same instance. */
  orchestrator?: TaskOrchestrator;
  /** Unique task ID for this harness instance. Auto-generated if not provided. */
  taskId?: string;
  /** Task ID of the parent harness, if this is a child agent. */
  parentTaskId?: string;
  /** Nesting depth (0 = root). */
  agentDepth?: number;
  /** Max nesting depth before spawn_agent is disabled. Default: 3. */
  maxAgentDepth?: number;
  /** Max total concurrent agents (across all depths). Default: 8. */
  maxConcurrentAgents?: number;
  /**
   * When false, stream retries always include the tool list (never omit tools on later attempts).
   * Default true: attempts 2+ may retry without tools to escape broken tool-call loops.
   */
  allowToollessStreamRetry?: boolean;
  /**
   * When true, inject a bounded [WORKING STATE] user block after inception on each
   * buildMessages (ZipAct-style). Updated by the harness after each tool batch.
   */
  workingStateEnabled?: boolean;
  /**
   * Initial persona for this harness session.
   * Can be changed at runtime via harness.setPersona(config, block).
   */
  persona?: PersonaConfig;
  /**
   * Dynamic world context injected as the very first message of a session.
   * Grounds the agent in real date/time, OS, shell, and CWD so it avoids
   * training-cutoff date drift and wrong shell syntax.
   *
   * - undefined (default): auto-gather all context, no location override
   * - { location: "Warsaw, Poland" }: auto-gather + include physical location
   * - { disabled: true }: skip injection entirely (child agents always skip)
   */
  worldContext?: WorldContextOptions;
  /** When enabled, run heuristic + optional LLM check before `requiresApproval` prompts. */
  safetyJudge?: AgentSafetyJudgeOptions;
  /**
   * Max ms to wait for human approval on destructive `requiresApproval` tools.
   * Default / env: AGENT_APPROVAL_TIMEOUT_MS (10s–600s, default 60s).
   */
  approvalTimeoutMs?: number;
  /** Optional loaded runtime preferences used as session defaults/overrides. */
  runtimePreferences?: RuntimePreferences | null;
  /** Optional persistence hook invoked when runtime preferences are changed in-session. */
  persistRuntimePreferences?: (prefs: RuntimePreferences) => Promise<string | void> | string | void;
}

// Re-export so consumers can type worldContext without importing world_context directly
export type { WorldContextOptions };
