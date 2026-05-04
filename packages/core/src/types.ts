import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";
import type { TaskOrchestrator } from "./orchestrator.js";
import type { WorldContextOptions } from "./world_context.js";

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
}

export interface ContextSnapshot {
  tokenCount: number;
  maxTokens: number;
  usageFraction: number;
  masked: boolean;
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

/** Emitted on turn_end for orchestration / eval surfaces (arXiv:2512.08296, 2601.06112). */
export interface TurnEndHarnessMetrics {
  /** Distinct tool names invoked at least once during this send(). */
  toolsInvokedThisSend: string[];
  /** Count of spawn_agent calls in this send(). */
  spawnAgentCallsThisSend: number;
  /** Size of the last completed parallel tool batch (0 if none). */
  parallelToolCallsLastBatch: number;
}

// ─── Events ───────────────────────────────────────────────────────────────────

export interface AgentEventMap {
  text: { delta: string };
  tool_start: { callId: string; name: string };
  tool_delta: { callId: string; argsDelta: string };
  tool_approval: {
    callId: string;
    name: string;
    args: Record<string, unknown>;
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
}

export type AgentEventName = keyof AgentEventMap;

// ─── Persona ──────────────────────────────────────────────────────────────────

/**
 * Persona configuration — defines the agent's name, identity, and communication style.
 * Changes tone and vocabulary only; operational protocols are immutable.
 */
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
   * Hard wall-clock timeout for the entire send() call in ms.
   * Default: 600_000 (10 minutes). Prevents hung streaming calls from blocking forever.
   * (#3 Hard Send Timeout)
   */
  sendTimeoutMs?: number;
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
}

// Re-export so consumers can type worldContext without importing world_context directly
export type { WorldContextOptions };
