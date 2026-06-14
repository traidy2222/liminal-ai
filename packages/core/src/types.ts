import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";
import type { ToolRegistry } from "./registry.js";
import type { ComposeDockWirePreview } from "./compose_dock_preview.js";
import type { TaskOrchestrator } from "./orchestrator.js";
import type { WorldContextOptions } from "./world_context.js";
import type { RuntimePreferences } from "./runtime_prefs.js";
import type { RuntimePersonaControls } from "./runtime_prefs.js";

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
  /** Union: value must satisfy exactly one branch (recursive). */
  anyOf?: PropertySchema[];
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
   * Danger level for tooling / UX (e.g. approval policy).
   * "destructive" tools use the approval path when `requiresApproval` is set; there is no think/plan dispatch gate.
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
  /**
   * Hard cap on tool result length in approximate tokens (1 token ≈ 4 chars).
   * When set, the dispatcher truncates over-long results and appends a notice.
   * Use for tools that may emit arbitrarily large output (e.g. run_shell, run_tests).
   */
  maxOutputTokens?: number;
}

export type ToolResult =
  | { ok: true; output: string }
  | { ok: false; error: string };

/**
 * emit(text) streams a progress line to the UI while the tool is running.
 * Call it for each meaningful milestone so the user can see the tool isn't stalled.
 * Text is appended to the live conversation stream (same channel as run_shell output).
 */
export type ToolHandler = (
  args: Record<string, unknown>,
  emit?: (text: string) => void
) => Promise<ToolResult>;

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

/** Current streaming wire protocol version. Bump when StreamChunk shape changes in a breaking way. */
export const STREAM_WIRE_VERSION = 1 as const;

export type ToolCallStreamDelta = {
  index: number;
  id: string;
  name: string;
  argsDelta: string;
  isNewTool: boolean;
};

export interface StreamChunk {
  /** Wire protocol version — always STREAM_WIRE_VERSION. Lets consumers detect shape changes. */
  version?: typeof STREAM_WIRE_VERSION;
  textDelta?: string;
  /** Provider-native reasoning tokens (OpenRouter / reasoning models). */
  reasoningDelta?: string;
  toolCallDelta?: ToolCallStreamDelta;
  /** Every tool-call delta in this provider chunk (some gateways batch multiple). */
  toolCallDeltas?: ToolCallStreamDelta[];
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
  protocolDynamicBuilder?: (toolNames: string[], intentHint?: string, registry?: ToolRegistry) => string;
  /**
   * Optional async callback that produces a 2-3 sentence causal narrative summary for a
   * batch of compressed tool rounds. Used by AGENT_COMPRESS_SEMANTIC=1 to replace
   * tool-name one-liners with causal summaries in compression blocks.
   * Called with the raw one-liner summaries; returns a semantic paragraph.
   */
  semanticSummarizer?: (rawSummaries: string) => Promise<string>;
}

export interface ContextSnapshot {
  tokenCount: number;
  maxTokens: number;
  usageFraction: number;
  masked: boolean;
  /** Tool schema tokens in the active completion request (when tools are known). */
  toolTokenCount?: number;
  /** Messages + tools + framing overhead (when enriched for UI). */
  requestTokenCount?: number;
  /** Window fraction including tool schemas (when enriched for UI). */
  requestUsageFraction?: number;
  contextTier?: "small" | "medium" | "large" | "xlarge";
  modelSlug?: string;
}

/** Structured working snapshot (COMPASS-style); rendered into [WORKING STATE]. */
export interface EpistemicState {
  goal: string;
  subgoals: {
    id: string;
    status: "todo" | "doing" | "done" | "blocked";
    note?: string;
  }[];
  /** Working hypotheses — updated by hypothesize() and rendered in [WORKING STATE]. */
  hypotheses: {
    /** Stable id (e.g. hyp:abc12) for supersede / cross-refs */
    id?: string;
    claim: string;
    confidence: "low" | "med" | "high";
    evidence?: string[];
    /** Concrete observations that would refute or weaken the claim */
    falsifiers?: string[];
    /** Smallest next check to validate or invalidate */
    next_test?: string;
    rationale?: string;
    status?: "active" | "superseded" | "confirmed" | "rejected";
    superseded_by?: string;
    at?: number;
  }[];
  /** Paths successfully read via read_file (and similar) this send; unioned across rounds. */
  filesTouched: string[];
  /** Paths successfully mutated by edit/write tools this send; unioned across rounds. */
  filesModified: string[];
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
  /**
   * Active hypotheses persisted across send() calls so the model can track
   * multi-turn investigative chains. Populated from EpistemicState at turn end;
   * restored into the initial EpistemicState at the next turn start.
   * Only hypotheses with status="active" (or undefined) are carried forward.
   */
  persistedHypotheses?: EpistemicState["hypotheses"];
}

// ─── Multi-agent orchestration ────────────────────────────────────────────────

export interface ChildAgentConfig {
  goal: string;
  /** Optional focused brief distinct from orchestration label goal. */
  taskBrief?: string;
  /**
   * Override the workspace root for this child. The child's send() runs inside
   * an AsyncLocalStorage scope so all `resolveWorkspaceRoot()` calls — and
   * thus file tools — operate on this path. Use with `git_worktree` to give a
   * sub-agent an isolated checkout that doesn't contend on the parent's locks.
   */
  workspaceRoot?: string;
  /** Whether child should inherit parent persona block. Default false (neutral worker persona). */
  inheritPersona?: boolean;
  /** Structured spawn contract for focused specialist behavior. */
  spawnContract?: SubagentSpawnContract;
  /** Observability metadata for contract provenance. */
  spawnContractSource?: "provided" | "synthesized";
  /**
   * Restrict child to only these tool names (allowlist).
   * undefined = inherit all registered tools from parent.
   * Use when you want a deliberately limited agent (e.g. read-only critic).
   */
  toolNames?: string[];
  /**
   * Force-activate these tool names in the child regardless of whether they are
   * active in the parent. Additive — does not restrict other tools.
   * Use to give a sub-agent capabilities the parent hasn't activated yet
   * (e.g. web_search, web_research, vault_write for a research sub-agent).
   * All named tools must be registered in the parent registry.
   */
  activateTools?: string[];
  /**
   * Force-activate these tool FAMILIES in the child (e.g. "code_intel", "shell",
   * "browser", "web"). More reliable than `activateTools` for provisioning a
   * sub-agent, since the spawner (or workflow planner) names families by intent
   * rather than guessing individual tool names. Applied on top of the BM25
   * family inference, so it can only add capabilities. Unknown families are
   * ignored.
   */
  activateFamilies?: string[];
  /** Extra context prepended to inception messages. */
  additionalContext?: string;
  /** Shared-bus keys to inject before the child runs (from share_agent_context). */
  contextKeys?: string[];
  /** Inject all shared-bus entries whose keys start with this prefix (e.g. "ctx/"). */
  contextBusPrefix?: string;
  /** Max ReAct rounds for this child. Defaults to parent's maxToolRoundsPerTurn. */
  maxRounds?: number;
  /** Timeout in ms before the child is auto-cancelled. Default: 300_000 (5 min). */
  timeoutMs?: number;
  /**
   * Custom system prompt appended to the protocol core as a final system message.
   * Sets the sub-agent's role, constraints, and output format contract.
   * Example: "You are a primary-source research analyst. Return JSON with keys: summary, key_stats[], sources[]."
   */
  systemPrompt?: string;
  /**
   * Task message sent as the first user turn (replaces goal as the send() message if provided).
   * Write this as the full detailed task — what to do, what to include, what to avoid.
   */
  userPrompt?: string;
  /**
   * DAG dependency task IDs — this child will be registered with these dependencies
   * so the orchestrator can resolve them before starting execution.
   */
  dependsOn?: string[];
}

export interface SubagentSpawnContract {
  role: string;
  objective: string;
  deliverableFormat: string;
  successCriteria: string[];
  nonGoals?: string[];
  allowedTools?: string[];
  handoffRequirements?: string[];
  budget?: {
    maxRounds?: number;
    maxToolCalls?: number;
    timeoutMs?: number;
  };
}

export interface SubtaskResult {
  taskId: string;
  ok: boolean;
  /** Last assistant message text, or error message. */
  output: string;
  rounds: number;
}

/** Why this send() ended (present on reliable turn_end emissions). */
export type TurnEndTerminationReason = "ok" | "round_cap" | "timeout" | "error" | "contract_budget";

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

// ─── Document generation IR ───────────────────────────────────────────────────

export type SlideLayout =
  | "hero"
  | "kpi"
  | "comparison"
  | "timeline"
  | "risk"
  | "quote"
  | "image_full"
  | "summary"
  | "default";

export type BulletEmphasis = "accent" | "muted" | "heading" | "normal";

/** A bullet is either a plain string (normal emphasis) or an object with explicit emphasis. */
export type BulletItem = string | { text: string; emphasis?: BulletEmphasis };

export interface DocStyleGenome {
  id: string;
  seed: string;
  /** Human-readable style summary generated from style_intent (e.g. "dark navy + gold accent"). */
  description?: string;
  palette: { background: string; foreground: string; accent: string; muted: string };
  typography: { heading: string; body: string; mono: string; scale: number[] };
  spacing: { base: number; rhythm: number };
  chart: { strokeWidth: number; cornerRadius: number; labelDensity: "low" | "med" | "high" };
}

export interface DocChunk {
  id: string;
  title: string;
  intent: "slide" | "section";
  /** Explicit slide layout. If absent the renderer falls back to keyword inference. */
  layout?: SlideLayout;
  bullets: BulletItem[];
  /** Visible footer text strip on the slide (≤200 chars, 12pt muted). Replaces narrative for on-slide use. */
  slide_body?: string;
  /** Presenter notes — exported to the notes pane only, never visible on slide. */
  speaker_notes?: string;
  /** @deprecated Use slide_body for on-slide text and speaker_notes for presenter notes. */
  narrative?: string;
  audienceIntent?: string;
  narrativeBeat?: string;
  visualIntent?: string;
  visuals?: Array<{ kind: "chart" | "image" | "table" | "quote"; note?: string }>;
  status: "planned" | "composed" | "lint_failed" | "repaired" | "rendered";
  lintIssues?: string[];
}

export interface DocumentIR {
  id: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  objective: string;
  audience: string;
  tone: string;
  autonomyMode?: "max" | "guided" | "strict";
  formatTargets: Array<"pptx" | "docx" | "pdf">;
  semanticOutline: string[];
  narrativeBeats?: string[];
  chunks: DocChunk[];
  style: DocStyleGenome;
  /** Natural-language style summary shown to model during chunk composition. */
  styleDescription?: string;
  claimSources?: Array<{
    claim: string;
    sources: string[];
    sourceQuality?: "official" | "primary" | "secondary";
    asOf?: string;
    confidence: "low" | "med" | "high";
  }>;
  sourceMap?: Array<{ id: string; type: "web" | "local" | "generated"; ref: string; note?: string }>;
  assetSelections?: Array<{ slideOrChunkId: string; kind: string; sourceRef: string; rationale?: string }>;
  chartData?: Array<{ id: string; title: string; series: Array<{ label: string; values: number[] }>; labels: string[] }>;
  lintHistory: Array<{ at: string; chunkId: string; issues: string[] }>;
  repairHistory: Array<{ at: string; chunkId: string; action: string }>;
  exports: Array<{ format: "pptx" | "docx" | "pdf"; path: string; generatedAt: string }>;
  runState?: {
    stage:
      | "planned"
      | "researching"
      | "composing"
      | "linting"
      | "repairing"
      | "rendering"
      | "qa_scored"
      | "exported";
    retries: number;
    failures: number;
    warnings: string[];
    repairBudget: { max: number; used: number };
    stageTrace: Array<{ at: string; stage: string; note?: string }>;
  };
}

export interface DocQualityReport {
  docId: string;
  score: number;
  structureFidelity: number;
  visualConsistency: number;
  readabilityDensity: number;
  factualCitationIntegrity: number;
  exportCorrectness: number;
  issues: string[];
}

// ─── Events ───────────────────────────────────────────────────────────────────

/**
 * Compact at-a-glance summary of a completed send() — emitted just before
 * `turn_end` for UIs that want to render a one-line header per turn.
 */
export interface TurnSummary {
  intentClass: string;
  /** scoreTurnOutcome [0, 1]. */
  outcomeScore: number;
  toolCount: number;
  roundCount: number;
  durationMs: number;
  /** First ~120 chars of the final assistant message. */
  finalAnswerPreview: string;
  /** Up to three most-used tool names this turn. */
  keyTools: string[];
  terminationReason: TurnEndTerminationReason;
  traceId?: string;
}

export interface AgentEventMap {
  /** Emitted at the start of each root/child send() with the user text (session logging). */
  send_start: { userMessage: string; agentDepth: number; traceId?: string };
  /** Assistant-visible stream; `trace` / `reasoning` are non-user channels (verbosity rules apply). */
  text: { delta: string; channel?: "user" | "trace" | "reasoning" };
  /** Provider transient error; UI may fold instead of chat-stuffing (AGENT_UI_VERBOSITY=quiet). */
  provider_retry: {
    attempt: number;
    maxAttempts: number;
    message: string;
    backoffMs: number;
  };
  tool_start: { callId: string; name: string; traceId?: string; roundIndex?: number };
  /** Spoken-channel clip ready for web playback (not shown in chat transcript). */
  speech: {
    clipId: string;
    text: string;
    audioUrl: string;
    durationSec?: number;
    costUsd?: number;
  };
  /** Live browser panel for embedded UIs (desktop/web) — viewport JPEG under workspace .agent_artifacts/browser/. */
  browser_view: {
    sessionId: string;
    url: string;
    title?: string;
    /** Workspace-relative path to the latest panel screenshot (jpeg). */
    imagePath?: string;
    open: boolean;
    updatedAt: number;
    viewportWidth?: number;
    viewportHeight?: number;
    liveStream?: boolean;
    embedMode?: "webview" | "screencast";
    chatId?: string;
  };
  /** Live terminal panel for embedded shells (desktop/web) — PTY session opened by agent or user. */
  terminal_view: {
    chatId: string;
    sessionId: string;
    label: string;
    source: "agent" | "user";
    cwd: string;
    open: boolean;
    focus: boolean;
    updatedAt: number;
  };
  tool_delta: {
    callId: string;
    argsDelta: string;
    /** Accumulated tool-call args JSON (authoritative for UI preview). */
    argsJson?: string;
    name?: string;
    /** Pre-parsed compose-dock preview (file / email right pane). */
    compose?: ComposeDockWirePreview;
  };
  /** Live right-pane preview — emitted on its own so UIs need not match tool_delta to messages. */
  compose_preview: {
    callId: string;
    name: string;
    argsJson: string;
    compose: ComposeDockWirePreview;
  };
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
    traceId?: string;
    roundIndex?: number;
  };
  ask_user: {
    prompt: string;
    resolve: (answer: string) => void;
  };
  /** Emitted when the user answers an ask_user prompt. (#7 Structured Event Log) */
  ask_user_answered: { prompt: string; answer: string };
  /** Compact summary of a completed send() — emitted just before `turn_end`. */
  turn_summary: TurnSummary;
  turn_end: {
    contextSnapshot: ContextSnapshot;
    /** Wall-clock time for the entire send() call in ms. */
    durationMs?: number;
    /** MAS / ReliabilityBench-style telemetry for this send() (cumulative where noted). */
    harnessMetrics?: TurnEndHarnessMetrics;
    /** Per-turn trace ID — same value emitted in send_start for correlation. */
    traceId?: string;
  };
  error: { err: Error };
  subtask_spawned: {
    taskId: string;
    parentTaskId: string;
    goal: string;
    depth: number;
    contractSource?: "provided" | "synthesized";
    role?: string;
    /** Tools visible to the child after spawn-time family inference + activate_tools. */
    activeToolCount?: number;
    activeFamilies?: string[];
    /** Families chosen by BM25 inference from spawn prompt text. */
    inferredFamilies?: string[];
  };
  /** Fast-model tool provisioning completed immediately before the child send(). */
  spawn_tools_inferred: {
    taskId: string;
    parentTaskId: string;
    families: string[];
    activateTools: string[];
    activeToolCount: number;
    rationale: string;
    source: "llm" | "skipped" | "failed";
  };
  subtask_complete: {
    taskId: string;
    ok: boolean;
    output: string;
    rounds: number;
    handoffWritten?: boolean;
  };
  /** Live output delta from a running sub-agent, forwarded to the parent's emitter. */
  subtask_output: {
    taskId: string;
    delta: string;
  };
  /** Harness trace lines from a sub-agent (spawn tools, auto-activate, etc.). */
  subtask_trace: {
    taskId: string;
    delta: string;
  };
  subtask_tool_start: {
    taskId: string;
    callId: string;
    name: string;
  };
  subtask_tool_result: {
    taskId: string;
    callId: string;
    name: string;
    args: Record<string, unknown>;
    ok: boolean;
    output: string;
  };
  /**
   * Emitted instead of tool_approval when dryRunApprovals is true.
   * The tool is auto-approved; no human interaction occurs.
   */
  approval_simulated: {
    callId: string;
    name: string;
    args: Record<string, unknown>;
    traceId?: string;
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
  /** Live context window usage — each ReAct round and after compression. */
  context_snapshot: { snapshot: ContextSnapshot };
  /** Wall-clock time for a tool handler execution. (#7) */
  tool_timing: { callId: string; name: string; durationMs: number };
  /** Inference latency metrics for observability. */
  inference_latency: {
    traceId?: string;
    model: string;
    requestStartMs: number;
    responseStartMs?: number;
    firstTokenMs?: number;
    completionMs?: number;
    totalLatencyMs?: number;
    ttftMs?: number;
  };
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
    personaControls?: RuntimePersonaControls;
  };
  runtime_pref_persisted: {
    path: string;
  };
  runtime_pref_rejected: {
    summary: string;
    reason: string;
  };
  auto_dream: {
    stage: "gate" | "started" | "progress" | "completed" | "failed";
    runId: string;
    gate?: {
      name: string;
      passed: boolean;
      reason?: string;
      value?: string | number | boolean;
    };
    progress?: {
      step: string;
      sessionsFound?: number;
      snippetsLoaded?: number;
      upserts?: number;
      deletes?: number;
    };
    result?: {
      summary?: string;
      upserts: number;
      deletes: number;
      durationMs: number;
    };
    error?: string;
  };
  spawn_contract_created: {
    taskId: string;
    source: "provided" | "synthesized";
    role: string;
    objective: string;
  };
  spawn_contract_applied: {
    taskId: string;
    role: string;
    deliverableFormat: string;
    allowedTools: string[];
  };
  spawn_contract_violation: {
    taskId: string;
    reason: string;
    severity: "low" | "med" | "high";
  };
  subtask_handoff_written: {
    taskId: string;
    key: string;
    bytes: number;
  };
  memory_retrieval_policy: {
    intent: "introspection" | "knowledge" | "research" | "coding" | "execution" | "conversational" | "creative";
    source: string;
    confidence?: number;
    threshold?: number;
    scope: "notes" | "vault" | "both";
    maxAgeDays?: number;
    minConfidence?: number;
    minQueryOverlap?: number;
    excludeTypes: string[];
    autoRecallAllowed: boolean;
    fallbackReason?: string;
    exploratoryCreative?: boolean;
    likelyEditPaths?: string[];
  };
  over_inference_check: {
    required: boolean;
    passed: boolean;
    reason: string;
    attemptedRecovery: boolean;
    source?: "llm" | "heuristic" | "none";
    confidence?: number;
    threshold?: number;
    fixHint?: string;
  };
  doc_stage: {
    docId: string;
    stage:
      | "planned"
      | "chunk_composed"
      | "chunk_linted"
      | "chunk_repaired"
      | "rendered"
      | "exported"
      | "qa_scored";
    note?: string;
  };
  doc_lint: {
    docId: string;
    chunkId: string;
    passed: boolean;
    issues: string[];
  };
  doc_repair: {
    docId: string;
    chunkId: string;
    action: string;
  };
  doc_export: {
    docId: string;
    format: "pptx" | "docx" | "pdf";
    path: string;
  };
  /** Research finalize checklist: advisory only — never mutates assistant text. */
  synthesis_check: {
    passed: boolean;
    reason: string;
    substantiveDraftComplete: boolean;
  };
  lint_heal_pass: {
    pass: number;
    maxPasses: number;
    scope: string[];
    mode: "tsc" | "eslint" | "command";
    diagnosticsTotal: number;
    errors: number;
    warnings: number;
    changedFirst: boolean;
  };
  lint_heal_result: {
    status: "success" | "escalated" | "skipped";
    passes: number;
    remainingDiagnostics: number;
    reason: string;
  };
  /** Circuit breaker opened after consecutive failures on the same tool. */
  tool_circuit_open: { name: string; remainMs: number };
  /**
   * Emitted by wait_for_agents when contradictory facts are detected across
   * sub-agent outputs. Parent should review and resolve before proceeding.
   */
  consensus_conflict: {
    taskIds: string[];
    conflicts: Array<{
      agentA: string;
      agentB: string;
      claimA: string;
      claimB: string;
      confidence: number;
    }>;
  };
  /** Streaming tool call index gap detected (provider sent non-contiguous indices). */
  stream_index_gap: { expectedIndex: number; receivedIndex: number };
  /** Approval request is still pending — emitted at 10s / 30s / 50s milestones. */
  approval_waiting: { callId: string; name: string; elapsedMs: number; totalMs: number };
  /** Idle personality heartbeat: armed after a successful turn (root only). */
  heartbeat_scheduled: {
    taskId: string;
    firesAtMs: number;
    idleMs: number;
  };
  heartbeat_started: {
    taskId: string;
    runId: string;
  };
  heartbeat_completed: {
    taskId: string;
    runId: string;
    summary: string;
    durationMs: number;
    reflectionsPreview?: string[];
    memoryWrites?: number;
    surfaceDecision: "none" | "trace" | "assistant";
    nudgeText?: string;
  };
  heartbeat_skipped: {
    taskId: string;
    reason: string;
    detail?: string;
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
  /**
   * Per-harness workspace root. When set, this harness's `send()` runs inside
   * an AsyncLocalStorage scope so `resolveWorkspaceRoot()` (and every tool that
   * uses it) returns this value. Defaults to the global root at construction.
   */
  workspaceRoot?: string;
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
  /**
   * When true, destructive approval-gated tools are auto-approved for this harness session.
   * Session-scoped only (intended for CLI/env launch flags like `--yolo`).
   */
  autoApproveDestructive?: boolean;
  /**
   * When true, all requiresApproval tools are auto-approved without blocking.
   * An `approval_simulated` event is emitted instead of `tool_approval`.
   * Intended for eval/test harnesses that need full ReAct runs without human input.
   */
  dryRunApprovals?: boolean;
  /** Optional loaded runtime preferences used as session defaults/overrides. */
  runtimePreferences?: RuntimePreferences | null;
  /** Optional persistence hook invoked when runtime preferences are changed in-session. */
  persistRuntimePreferences?: (prefs: RuntimePreferences) => Promise<string | void> | string | void;
  /** Optional sidecar vision model configuration (Owl remains primary reasoning model). */
  vision?: {
    model?: string;
    baseURL?: string;
    apiKey?: string;
    timeoutMs?: number;
    maxImageBytes?: number;
  };
  /**
   * Cross-harness shared memory bus for sibling/parent-child fact sharing within a session.
   * Pass the same instance to all harnesses that should communicate.
   * If not provided on root, one is created automatically and propagated to children.
   */
  sharedBus?: import("./shared_memory_bus.js").SharedMemoryBus;
}

// Re-export so consumers can type worldContext without importing world_context directly
export type { WorldContextOptions };
