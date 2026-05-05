import OpenAI from "openai";
import type { Stream } from "openai/streaming";
import type {
  AgentConfig,
  Message,
  AccumulatedToolCall,
  ChildAgentConfig,
  SubtaskResult,
  PersonaConfig,
  TurnEndHarnessMetrics,
  TurnEndTerminationReason,
  ToolResult,
  ExecutionState,
  ExecutionContract,
} from "./types.js";
import { AgentEmitter } from "./events.js";
import { ContextManager } from "./context.js";
import { ToolRegistry } from "./registry.js";
import { ToolDispatcher } from "./dispatcher.js";
import { SafetyJudge } from "./safety_judge.js";
import { StreamAccumulator } from "./streaming.js";
import { TaskOrchestrator } from "./orchestrator.js";
import { buildWorldContextMessage } from "./world_context.js";
import { rewriteQueryForRecall, type RewriteQueryResult } from "./query_rewrite.js";
import { distillToolOutput, shouldDistillToolOutput } from "./output_distill.js";
import { appendFailureLog } from "./failure_log.js";
import { completeChatJson, getFastModelSlug } from "./router.js";
import { stableArgsJsonKey } from "./json_stable.js";
import { HARNESS_RULE_RECALL_MESSAGE } from "./harness_rules.js";
import { bumpRecipePattern } from "./recipe_library.js";
import {
  markEpistemicPlanStepDone,
  mergeExtractedSubgoals,
  subgoalsFromPlanSteps,
} from "./epistemic_state.js";
import {
  appendRecoveryRecord,
  advanceExecutionStateForPlan,
  createDefaultExecutionState,
  markExecutionContractStatus,
  updateDriftScore,
} from "./execution_state.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function resolveApprovalTimeoutMs(config: AgentConfig): number {
  if (config.approvalTimeoutMs != null && Number.isFinite(config.approvalTimeoutMs)) {
    return Math.max(10_000, Math.min(600_000, config.approvalTimeoutMs));
  }
  const raw = process.env["AGENT_APPROVAL_TIMEOUT_MS"]?.trim();
  if (raw) {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n)) return Math.max(10_000, Math.min(600_000, n));
  }
  return 60_000;
}

function isUiQuiet(): boolean {
  return process.env["AGENT_UI_VERBOSITY"] === "quiet";
}

/**
 * Extract a human-readable message from any error the OpenAI SDK or
 * OpenRouter can throw.
 */
function describeError(err: unknown): string {
  if (err instanceof OpenAI.APIError) {
    const body =
      typeof err.error === "object" && err.error !== null
        ? JSON.stringify(err.error)
        : String(err.error ?? err.message);
    return `HTTP ${err.status} from ${err.name}: ${body}`;
  }
  return err instanceof Error ? err.message : String(err);
}

/** Returns true for errors worth retrying. */
function isRetryable(err: unknown): boolean {
  if (err instanceof OpenAI.RateLimitError) return true;
  if (err instanceof OpenAI.InternalServerError) return true;
  if (err instanceof OpenAI.APIConnectionError) return true;
  if (err instanceof OpenAI.APIError && err.status != null && err.status >= 500)
    return true;
  if (
    err instanceof OpenAI.BadRequestError &&
    typeof err.message === "string" &&
    err.message.toLowerCase().includes("provider")
  )
    return true;
  return false;
}

/** Heuristic: assistant answer likely cites repo facts worth double-checking. */
function isEvidenceToolName(name: string): boolean {
  return (
    name === "read_file" ||
    name === "web_fetch" ||
    name === "recall_relevant" ||
    name === "vault_read" ||
    name === "run_shell"
  );
}

function shouldRunCriticPass(assistantText: string): boolean {
  if (assistantText.length < 80) return false;
  if (assistantText.includes("```")) return true;
  if (/packages[/\\]|[/\\]src[/\\]|\.\/[a-z]/i.test(assistantText)) return true;
  return false;
}

/** True when final text likely depends on repo paths / code (AGENT_CRITIC_REQUIRE path trigger). */
function looksPathOrCodeHeavy(assistantText: string): boolean {
  if (assistantText.length < 40) return false;
  if (/packages[/\\]|[/\\]src[/\\]|\.(ts|tsx|js|jsx|json|md)\b/i.test(assistantText)) return true;
  if (/`[^`]{3,}\.(ts|tsx|js|json)`/.test(assistantText)) return true;
  return false;
}

function normPathForMatch(p: string): string {
  return p.replace(/\\/g, "/").toLowerCase();
}

function assistantCitesPath(assistantText: string, paths: string[]): boolean {
  const t = normPathForMatch(assistantText);
  for (const p of paths) {
    const n = normPathForMatch(p);
    if (n.length >= 4 && t.includes(n)) return true;
    const base = n.split("/").pop();
    if (base && base.length >= 4 && t.includes(base)) return true;
  }
  return false;
}

/** Simple djb2 hash → short hex string for recipe/reflexion key generation. */
function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return (h >>> 0).toString(16);
}

function normalizeIntentText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function lexicalTokens(text: string): string[] {
  return normalizeIntentText(text)
    .split(" ")
    .filter((t) => t.length >= 3);
}

function lexicalJaccard(a: string, b: string): number {
  const as = new Set(lexicalTokens(a));
  const bs = new Set(lexicalTokens(b));
  if (as.size === 0 || bs.size === 0) return 0;
  let inter = 0;
  for (const t of as) if (bs.has(t)) inter += 1;
  const union = new Set([...as, ...bs]).size;
  return union > 0 ? inter / union : 0;
}

function normalizeSearchDelta(text: string): string {
  return text
    .replace(/\uFFFD/g, "")
    .replace(/([A-Za-z])⚙([A-Za-z])/g, "$1$2");
}

function isVaultFirstStrictEnabled(): boolean {
  // Strict blocking is opt-in only.
  return process.env["AGENT_VAULT_FIRST_STRICT"] === "1";
}

type VaultAutoWriteMode = "off" | "research" | "aggressive";

function resolveVaultAutoWriteMode(): VaultAutoWriteMode {
  const raw = (process.env["AGENT_VAULT_AUTO_WRITE"] ?? "").trim().toLowerCase();
  if (raw === "0" || raw === "off" || raw === "false" || raw === "disabled") return "off";
  if (raw === "aggressive") return "aggressive";
  // Default behavior: keep a wiki for research/knowledge turns.
  return "research";
}

/**
 * Unified 12-category error taxonomy (#9 — TraceCoder arXiv:2602.06875 + Tool Invocation Reliability arXiv:2601.16280).
 * First match wins — ordered most-specific before general.
 */
const ERROR_TAXONOMY: Array<{
  pattern: RegExp;
  category: string;
  hint: string;
  template: string;
}> = [
  {
    pattern: /enoent|no such file|cannot find|path not found/i,
    category: "PATH_NOT_FOUND",
    hint: "File or directory does not exist at the given path.",
    template: "Use list_dir(parent_dir) to confirm the exact path exists, then retry with the corrected path.",
  },
  {
    pattern: /eperm|eacces|permission denied/i,
    category: "PERMISSION_DENIED",
    hint: "Insufficient filesystem permissions.",
    template: "Check file ownership. On Windows, ensure the process has write access to this directory.",
  },
  {
    pattern: /http 4[0-9][0-9]|status 4[0-9][0-9]|status: 4[0-9][0-9]/i,
    category: "HTTP_CLIENT_ERROR",
    hint: "Server rejected the request (4xx).",
    template: "Verify the URL with web_search first. Check auth headers, query parameters, and request body.",
  },
  {
    pattern: /http 5[0-9][0-9]|status 5[0-9][0-9]|status: 5[0-9][0-9]/i,
    category: "HTTP_SERVER_ERROR",
    hint: "Remote server returned a 5xx error.",
    template: "Retry once; if it persists, try a different endpoint or ask_user to confirm the service is available.",
  },
  {
    pattern: /invalid json|unexpected token|json parse|failed to parse/i,
    category: "JSON_PARSE_ERROR",
    hint: "Response or argument is malformed JSON.",
    template: "Double-check JSON syntax in args. Use think() to construct correct JSON before retrying.",
  },
  {
    pattern: /invalid args|missing required|expected |type mismatch|must be one of/i,
    category: "ARG_SCHEMA_MISMATCH",
    hint: "Tool argument types or required fields are wrong.",
    template: "Re-read the tool description carefully. Check exact types (string vs number vs array). Use think() to construct the correct args.",
  },
  {
    pattern: /timeout|timed out|deadline exceeded/i,
    category: "TIMEOUT",
    hint: "Operation exceeded its time limit.",
    template: "Reduce scope: split the work into smaller parts. For shell commands, use run_background for long-running processes.",
  },
  {
    pattern: /resource locked|lock held|locked by another/i,
    category: "RESOURCE_LOCK",
    hint: "Another agent holds a lock on this resource.",
    template: "Use list_agents() to see who holds the lock. Wait for them to finish, or work on a different resource.",
  },
  {
    pattern: /spawn.*failed|command not found|not found in path|is not recognized/i,
    category: "COMMAND_NOT_FOUND",
    hint: "The executable does not exist in PATH.",
    template: "Verify the command is installed. Use run_shell('which <cmd>') or run_shell('where <cmd>') to check.",
  },
  {
    pattern: /econnrefused|econnreset|getaddrinfo|network|dns lookup/i,
    category: "NETWORK_FAILURE",
    hint: "Network connectivity or DNS resolution failed.",
    template: "Check if the target service is reachable. Try a different URL or ask_user if the service requires VPN/auth.",
  },
  {
    pattern: /enomem|out of memory|heap out of memory/i,
    category: "MEMORY_PRESSURE",
    hint: "Process ran out of memory.",
    template: "Reduce data size: read files in chunks, limit shell output, or split into smaller sub-tasks.",
  },
  {
    pattern: /unknown tool|tool not found|not registered/i,
    category: "UNKNOWN_TOOL",
    hint: "Tool name is invalid or not available in this agent context.",
    template: "Only call tools explicitly listed in the system prompt. Sub-agents have a restricted tool set.",
  },
];

/** Pattern-match error string to a structured recovery hint. (#9) */
function buildRecoveryHint(errorSummary: string): string {
  for (const entry of ERROR_TAXONOMY) {
    if (entry.pattern.test(errorSummary)) {
      return `[${entry.category}] ${entry.hint}\nFix: ${entry.template}`;
    }
  }
  return "[UNKNOWN_ERROR] Use think() to diagnose the root cause. Examine the exact error message before retrying with different args.";
}

/** Per-tool adaptive hint shown after repeated consecutive failures. (#9 unified) */
function buildAdaptiveHint(toolName: string, failCount: number): string {
  const toolHints: Record<string, string> = {
    read_file: "Use list_dir first to confirm the exact path exists before retrying.",
    write_file: "Confirm the parent directory exists with list_dir; use absolute paths.",
    run_shell: "Check cwd and command syntax. For long processes, use run_background instead.",
    run_background: "Ensure the command is valid and cwd exists. Check startup_wait_ms.",
    web_fetch: "Verify the URL is correct with web_search first. Check for auth/redirects.",
    web_search: "Rephrase the query or use a more specific search term.",
    recall: "Key may differ — use search_memory to find it by content.",
    spawn_agent: "Check depth limits and concurrent count with list_agents first.",
    write_file_hint: "Read the file first to see current content, then write the full merged result.",
  };
  const hint = toolHints[toolName] ?? "Re-read the tool description and verify your argument types.";
  return `[ADAPTIVE HINT] ${toolName} has failed ${failCount} time(s) this turn. ${hint}`;
}

// ─── Harness ─────────────────────────────────────────────────────────────────

/**
 * Names of harness-scoped tools that must NOT be copied from parent to child registry.
 * Each child gets fresh instances of these (via onChildCreated) that close over the
 * correct harness/context reference. Copying the parent's version would either crash
 * (double-register) or silently use the wrong harness context.
 */
const ORCHESTRATION_TOOL_NAMES = new Set([
  "spawn_agent",
  "wait_for_agents",
  "cancel_agent",
  "list_agents",
  "verify_result",          // closes over harness.forkChild
  "evidence_critic",
  "path_critic",
  "policy_critic",
  "check_context",          // closes over parent's ContextManager — child needs its own
  "compress_context",       // same
  "refresh_world_context",  // root-only; children skip world context entirely
  "set_persona",            // closes over parent harness — child inherits parent's persona
]);

// ADAPTIVE_HINTS removed — unified into buildAdaptiveHint() with ERROR_TAXONOMY (#9)

export class AgentHarness {
  readonly emitter: AgentEmitter;
  registry: ToolRegistry;           // non-readonly so forkChild can scope it
  readonly config: AgentConfig;     // exposed for child harness creation
  readonly taskId: string;
  readonly orchestrator: TaskOrchestrator;
  readonly agentDepth: number;

  private readonly context: ContextManager;
  private readonly dispatcher: ToolDispatcher;
  private readonly client: OpenAI;
  private readonly maxAgentDepth: number;
  private readonly maxConcurrentAgents: number;
  /** Human approval TTL for destructive requiresApproval tools (dispatcher). */
  private readonly approvalTimeoutMs: number;
  private running = false;
  private abortSignal?: AbortSignal;

  /** Incremented each ReAct round; accessible for subtask result reporting. */
  roundCount = 0;

  /**
   * Called after forkChild creates a child harness, before running it.
   * Set by external code (orchestration tools) to register child-scoped tools.
   */
  onChildCreated?: (child: AgentHarness) => void;

  // ── Per-turn tracking (reset at start of each send()) ──────────────────────
  private toolErrorCounts = new Map<string, number>();
  private toolsUsedThisTurn: string[] = [];
  private lastUserMessage = "";
  private contextAlertFired60 = false;
  private contextAlertFired85 = false;
  /** Wall-clock start time of the current send() call. */
  private sendStartTime = 0;
  /** Size of the most recent parallel tool batch (for turn_end metrics). */
  private lastParallelToolBatchSize = 0;

  /** True once world context has been injected (only happens on the first send() of a root agent). */
  private worldContextInjected = false;

  /** Paths successfully read_file'd this send (working state). */
  private filesReadThisTurn: string[] = [];
  /** Last few tool outcome one-liners for working state. */
  private recentToolOutcomeLines: string[] = [];
  private proactiveCompressedThisSend = false;
  private criticConsumedThisSend = false;
  /** Cached query rewrite for mid-turn recall (AGENT_QUERY_REWRITE). */
  private recallRewriteThisSend: RewriteQueryResult | null = null;
  /** Evidence excerpts for evidence-bounded critic (AGENT_CRITIC_EVIDENCE). */
  private evidenceLog: Array<{
    toolCallId: string;
    name: string;
    hash: string;
    excerpt: string;
  }> = [];

  /** At most one turn_end per send() — round cap / timeout / error paths share this. */
  private turnEndEmittedThisSend = false;
  /** AGENT_FINALIZE_HINT: inject the budget nudge at most once per send(). */
  private finalizeHintInjectedThisSend = false;
  /** One-shot rule recall suffix (named protocol rules) at round 2. */
  private ruleRecallInjectedThisSend = false;
  /** Extra stream continuation when model hits token limit (max 1 per send). */
  private lengthResumeRemaining = 0;
  /** One-shot nudge to cite a read path before turn_end(ok). */
  private finalizeCiteNudgeThisSend = false;
  /** One-shot nudge for research synthesis completeness before turn_end(ok). */
  private finalizeSynthesisNudgeThisSend = false;
  /** web_search query history for first-pass diversity + dedupe checks. */
  private webSearchQueriesThisTurn: string[] = [];
  /** Near-duplicate failed search intents for one-shot retry discipline. */
  private failedSearchIntentCounts = new Map<string, number>();

  /** Active persona. Set via setPersona(); defaults to config.persona or unnamed default. */
  private currentPersona?: PersonaConfig;
  /** Long-horizon runtime state persisted by task_checkpoint and heartbeat events. */
  private executionState: ExecutionState | null = null;
  private vaultMetrics = { reads: 0, searches: 0, writes: 0, skippedWrites: 0 };

  /**
   * Returns the ContextManager for use by context tools factory.
   * @internal — used by packages/tools createContextTools factory.
   */
  getContext(): ContextManager {
    return this.context;
  }

  getExecutionState(): ExecutionState | null {
    return this.executionState;
  }

  private getActiveContract(): ExecutionContract | null {
    if (!this.executionState?.activeContractId) return null;
    return this.executionState.contracts.find((c) => c.id === this.executionState!.activeContractId) ?? null;
  }

  private isLikelyKnowledgeTask(): boolean {
    const t = this.lastUserMessage.toLowerCase();
    return (
      /research|learn|explain|why|how|compare|summar|document|wiki|knowledge|paper|reference|history|background|meaning|what is/.test(
        t
      ) && !/build|compile|typecheck|test|lint|run the tests|npm run/.test(t)
    );
  }

  private hasVaultOrMemoryPrimingThisTurn(): boolean {
    const used = new Set(this.toolsUsedThisTurn);
    return (
      used.has("memory_query") ||
      used.has("recall_relevant") ||
      used.has("vault_search") ||
      used.has("vault_read")
    );
  }

  private checkContractAndCommitments(
    toolName: string,
    args: Record<string, unknown>
  ): { ok: true } | { ok: false; reason: string; severity: "low" | "med" | "high" } {
    if (
      isVaultFirstStrictEnabled() &&
      toolName === "web_search" &&
      this.isLikelyKnowledgeTask() &&
      !this.hasVaultOrMemoryPrimingThisTurn()
    ) {
      this.emitter.emit("vault_activity", {
        action: "search",
        ok: false,
        reason: "vault_first_blocked_web_search_without_memory_or_vault_priming",
      });
      return {
        ok: false,
        reason:
          'Vault-first policy: call memory_query/recall_relevant or vault_search/vault_read before web_search for knowledge tasks.',
        severity: "med",
      };
    }
    if (
      toolName === "web_search" &&
      this.isLikelyKnowledgeTask() &&
      !this.hasVaultOrMemoryPrimingThisTurn()
    ) {
      // Advisory telemetry only: we no longer hard-block web search.
      this.emitter.emit("vault_activity", {
        action: "search",
        ok: false,
        reason: "vault_first_advisory_no_priming_before_web_search",
      });
    }
    if (toolName === "web_search") {
      const query = typeof args["query"] === "string" ? args["query"].trim() : "";
      if (query.length >= 8 && this.isLikelyKnowledgeTask()) {
        const norm = normalizeIntentText(query);
        const failed = this.failedSearchIntentCounts.get(norm) ?? 0;
        if (failed >= 1) {
          return {
            ok: false,
            reason:
              "Repeated failed web_search intent detected. Rephrase with a different angle before retrying.",
            severity: "med",
          };
        }
        if (this.webSearchQueriesThisTurn.length < 3) {
          for (const prior of this.webSearchQueriesThisTurn) {
            const overlap = lexicalJaccard(prior, query);
            if (overlap >= 0.72) {
              return {
                ok: false,
                reason:
                  `First-pass web_search queries must be diverse (overlap=${overlap.toFixed(2)}). ` +
                  "Use a different intent bucket: origins/background, latest status, impact/metrics.",
                severity: "low",
              };
            }
          }
        }
      }
    }
    const state = this.executionState;
    if (!state) return { ok: true };
    const contract = this.getActiveContract();
    if (contract?.allowedTools && contract.allowedTools.length > 0) {
      if (!contract.allowedTools.includes(toolName)) {
        return {
          ok: false,
          reason: `Tool "${toolName}" is not allowed by active contract ${contract.id}.`,
          severity: "med",
        };
      }
    }
    for (const c of state.commitments) {
      if (c.blockedTools?.includes(toolName)) {
        return {
          ok: false,
          reason: `Blocked by commitment "${c.label}".`,
          severity: c.severity,
        };
      }
      if (c.pattern && toolName.includes(c.pattern)) {
        return {
          ok: false,
          reason: `Tool "${toolName}" violates commitment pattern "${c.pattern}".`,
          severity: c.severity,
        };
      }
    }
    return { ok: true };
  }

  /** Wall-clock ms for tool approval auto-reject (UI countdown, session logs). */
  getApprovalTimeoutMs(): number {
    return this.approvalTimeoutMs;
  }

  /** True while a send() / ReAct loop is in progress. */
  getIsRunning(): boolean {
    return this.running;
  }

  /**
   * Clear chat transcript and re-enable world-context injection on next root send().
   * Persona override is preserved (same as reset()).
   */
  clearConversation(): void {
    this.reset();
  }

  /**
   * Hot-swap the agent's persona without restarting the session.
   * @param config - The new persona metadata (name, description, traits…)
   * @param block  - The pre-built system-prompt string for the identity block.
   *                 Built by tools/persona_presets.ts to avoid circular deps.
   */
  setPersona(config: PersonaConfig, block: string): void {
    this.currentPersona = config;
    this.context.setPersonaBlock(block);
    this.emitter.emit("persona_changed", {
      name: config.name,
      description: config.description,
    });
  }

  /**
   * Restore inception identity from config (clears runtime persona override).
   * Used when the user resets to the default agent voice.
   */
  resetPersona(): void {
    this.currentPersona = undefined;
    this.context.clearPersonaBlock();
    const p = this.config.persona;
    this.emitter.emit("persona_changed", {
      name: p?.name ?? "Liminal",
      description: p?.description ?? "Default inception identity restored.",
    });
  }

  /** Returns the currently active persona config, or undefined if default. */
  getCurrentPersona(): PersonaConfig | undefined {
    return this.currentPersona ?? this.config.persona;
  }

  private getEvidencePackForCritic(): string {
    if (this.evidenceLog.length === 0) return "";
    return this.evidenceLog
      .slice(-28)
      .map(
        (e) =>
          `[${e.name} id=${e.toolCallId} hash=${e.hash.slice(0, 12)}]\n${e.excerpt.replace(/\n/g, " ").slice(0, 520)}`
      )
      .join("\n\n")
      .slice(0, 12_000);
  }

  private get maxRetries() {
    return this.config.maxRetries ?? 3;
  }
  private get retryDelayMs() {
    return this.config.retryDelayMs ?? 1500;
  }

  constructor(config: AgentConfig) {
    this.config = config;
    this.taskId = config.taskId ?? crypto.randomUUID();
    this.agentDepth = config.agentDepth ?? 0;
    this.maxAgentDepth = config.maxAgentDepth ?? 3;
    this.maxConcurrentAgents = config.maxConcurrentAgents ?? 8;
    this.approvalTimeoutMs = resolveApprovalTimeoutMs(config);

    this.emitter = new AgentEmitter();
    this.registry = new ToolRegistry();
    // Wire onCompressed callback so context compression fires a structured event (#7)
    this.context = new ContextManager({
      ...config.context,
      onCompressed: (before, after, rounds) => {
        this.emitter.emit("context_compressed", {
          beforeFraction: before,
          afterFraction: after,
          roundsCompressed: rounds,
        });
      },
    });

    // Root creates orchestrator; children receive the same instance
    this.orchestrator =
      config.orchestrator ?? new TaskOrchestrator();

    this.client = new OpenAI({
      apiKey: config.openRouterApiKey,
      baseURL: config.baseURL,
      maxRetries: 0,
      defaultHeaders: {
        "HTTP-Referer": "https://github.com/liminal-ai",
        "X-Title": "Liminal",
      },
    });

    const safetyJudge =
      config.safetyJudge?.enabled === true
        ? new SafetyJudge(this.client, {
            model: config.safetyJudge.model ?? config.model,
            timeoutMs: config.safetyJudge.timeoutMs,
            cacheTtlMs: config.safetyJudge.cacheTtlMs,
            failOpen: config.safetyJudge.failOpen,
          })
        : undefined;

    this.dispatcher = new ToolDispatcher(
      this.registry,
      this.emitter,
      this.orchestrator,
      this.taskId,
      safetyJudge,
      this.approvalTimeoutMs,
      (toolName, args) => this.checkContractAndCommitments(toolName, args)
    );

    // Register self in orchestrator
    this.orchestrator.register({
      taskId: this.taskId,
      parentTaskId: config.parentTaskId,
      goal: "(root)",
      depth: this.agentDepth,
      startedAt: Date.now(),
      status: "running",
      abortController: new AbortController(),
    });
  }

  async send(userMessage: string, options?: { freshContext?: boolean }): Promise<void> {
    if (this.running) throw new Error("Agent is already processing a message");
    if (options?.freshContext === true && this.agentDepth === 0) {
      this.reset();
    }
    this.running = true;

    // Reset per-turn tracking state
    this.toolErrorCounts = new Map();
    this.toolsUsedThisTurn = [];
    this.lastUserMessage = userMessage;
    this.contextAlertFired60 = false;
    this.contextAlertFired85 = false;
    this.lastParallelToolBatchSize = 0;
    this.sendStartTime = Date.now();
    this.filesReadThisTurn = [];
    this.recentToolOutcomeLines = [];
    this.proactiveCompressedThisSend = false;
    this.criticConsumedThisSend = false;
    this.recallRewriteThisSend = null;
    this.evidenceLog = [];
    this.turnEndEmittedThisSend = false;
    this.finalizeHintInjectedThisSend = false;
    this.ruleRecallInjectedThisSend = false;
    this.lengthResumeRemaining =
      parseInt(process.env["AGENT_LENGTH_RESUME_MAX"] ?? "1", 10) > 0 ? 1 : 0;
    this.finalizeCiteNudgeThisSend = false;
    this.finalizeSynthesisNudgeThisSend = false;
    this.dispatcher.resetTurnCounters();
    this.vaultMetrics = { reads: 0, searches: 0, writes: 0, skippedWrites: 0 };
    this.webSearchQueriesThisTurn = [];
    this.failedSearchIntentCounts = new Map();

    if (this.config.workingStateEnabled !== false) {
      this.context.initEpistemicState(userMessage);
      const b0 = this.context.getContextBudgetAdvice();
      this.context.patchEpistemicState({
        goal: userMessage.slice(0, 2000),
        budget: {
          usagePct: Math.round(b0.usageFraction * 100),
          recallK: b0.recommendedRecallK,
          spareRounds: b0.suggestedMaxExtraRounds,
        },
      });
    }
    this.executionState = createDefaultExecutionState(userMessage);
    this.emitter.emit("execution_state", {
      missionId: this.executionState.mission?.id,
      activeContractId: this.executionState.activeContractId,
      driftScore: this.executionState.driftScore,
      milestoneCount: this.executionState.milestones.length,
      contractCount: this.executionState.contracts.length,
    });

    if (process.env["AGENT_QUERY_REWRITE"] === "1") {
      try {
        this.recallRewriteThisSend = await rewriteQueryForRecall(
          userMessage,
          this.client,
          this.config.model
        );
      } catch {
        this.recallRewriteThisSend = null;
      }
    }

    try {
      this.emitter.emit("send_start", {
        userMessage,
        agentDepth: this.agentDepth,
      });

      // Inject world context on the first turn of a root agent (#world-context).
      // Child agents (depth > 0) skip this — they inherit context from their parent.
      if (!this.worldContextInjected && this.agentDepth === 0) {
        this.worldContextInjected = true;
        const worldCtx = await buildWorldContextMessage({
          ...this.config.worldContext,
          firstUserMessage: userMessage,
        });
        if (worldCtx) {
          this.context.append({ role: "user", content: worldCtx });
          // Brief acknowledgement so the model registers it as processed context,
          // not as a pending user request.
          this.context.append({
            role: "assistant",
            content:
              "[World context received. I'll use the current date/time, correct shell syntax, " +
              "and accurate path format for this platform throughout the session.]",
          });
        }
      }

      this.context.append({ role: "user", content: userMessage });
      await this.runReActLoop();

      // Episodic recipe recording (#7 AMA-Bench): persist successful patterns
      // Awaited with error boundary (#2 VIGIL) — no silent swallowing
      if (this.toolsUsedThisTurn.length >= 4 && this.registry.has("remember")) {
        const recipeKey = `recipe:${hashString(userMessage).slice(0, 10)}`;
        const recipeValue =
          `GOAL: ${userMessage.slice(0, 60)}\n` +
          `PATTERN: ${this.toolsUsedThisTurn.join(" → ")}\n` +
          `ROUNDS: ${this.roundCount}`;
        try {
          await this.dispatcher.directCall("remember", { key: recipeKey, value: recipeValue });
          void bumpRecipePattern(recipeValue);
        } catch (err) {
          this.emitter.emit("text", {
            delta: `\n[HARNESS] Recipe persist failed: ${err instanceof Error ? err.message : String(err)}\n`,
            channel: "trace",
          });
        }
      }
    } catch (err) {
      const msg = describeError(err);
      this.emitter.emit("error", {
        err: new Error(msg),
      });
      this.emitTurnEnd("error");
    } finally {
      if (!this.turnEndEmittedThisSend) {
        this.emitTurnEnd("error");
      }
      this.running = false;
    }
  }

  /** Returns the last assistant text message (used by parent to extract subtask result). */
  getLastAssistantMessage(): string {
    return this.context.getLastAssistantMessage() ?? "(no output)";
  }

  /**
   * Spawn a child AgentHarness to run a focused subtask independently.
   * Returns immediately with {taskId, promise}. Awaiting the promise blocks
   * until the child completes.
   */
  forkChild(
    childConfig: ChildAgentConfig
  ): { taskId: string; promise: Promise<SubtaskResult> } {
    // ── Depth / concurrency guards ───────────────────────────────────────────
    if (this.agentDepth >= this.maxAgentDepth) {
      throw new Error(
        `Max agent depth (${this.maxAgentDepth}) reached — cannot spawn further sub-agents`
      );
    }
    const running = this.orchestrator.runningCount();
    if (running >= this.maxConcurrentAgents) {
      throw new Error(
        `Max concurrent agents (${this.maxConcurrentAgents}) reached — wait for some to complete before spawning more`
      );
    }

    const childId = crypto.randomUUID();
    const abortController = new AbortController();

    // ── Build scoped tool registry ───────────────────────────────────────────
    const childRegistry = new ToolRegistry();
    const childDepth = this.agentDepth + 1;
    const depthAllowsOrchestration = childDepth < this.maxAgentDepth;

    for (const tool of this.registry.getAll()) {
      if (ORCHESTRATION_TOOL_NAMES.has(tool.name)) {
        // Skip parent's orchestration tools — child gets fresh ones below
        continue;
      }
      // If a toolNames filter is specified, only include allowed tools
      if (childConfig.toolNames && !childConfig.toolNames.includes(tool.name)) {
        continue;
      }
      childRegistry.register(tool);
    }

    childRegistry.copyLazyPolicyFromParent(this.registry);

    const personaMsg = this.context.getEffectiveInception()[0]!;
    const coreRaw = this.config.context.inceptionMessages[1];
    const coreStr = typeof coreRaw?.content === "string" ? coreRaw.content : "";
    const subtaskTail: Message[] = childConfig.additionalContext
      ? [
          {
            role: "user" as const,
            content: `[SUBTASK CONTEXT] ${childConfig.additionalContext}`,
          },
        ]
      : [];
    const childInceptionBase: Message[] = [
      personaMsg,
      { role: "system" as const, content: coreStr },
      ...subtaskTail,
    ];

    // ── Create child harness ────────────────────────────────────────────────
    const childHarness = new AgentHarness({
      ...this.config,
      taskId: childId,
      parentTaskId: this.taskId,
      orchestrator: this.orchestrator,
      agentDepth: childDepth,
      maxAgentDepth: this.maxAgentDepth,
      maxConcurrentAgents: this.maxConcurrentAgents,
      context: {
        ...this.config.context,
        inceptionMessages: childInceptionBase,
        protocolDynamicBuilder: undefined,
      },
      maxToolRoundsPerTurn:
        childConfig.maxRounds ?? this.config.maxToolRoundsPerTurn,
    });

    // Replace child's empty registry with the scoped one
    childHarness.registry = childRegistry;
    childHarness.abortSignal = abortController.signal;

    // Propagate hook so depth-2+ children get harness-scoped tools (orchestration, context, …).
    // Only the root had this set from registerAllTools — without inheritance, grandchildren
    // would keep a stripped registry and never re-register.
    childHarness.onChildCreated = this.onChildCreated;

    // Notify external code (orchestration tools) to register child-scoped tools
    // (e.g. spawn_agent closing over childHarness for grandchild support)
    if (depthAllowsOrchestration) {
      this.onChildCreated?.(childHarness);
    }

    const dyn =
      this.config.context.protocolDynamicBuilder?.(childHarness.registry.getActiveToolNames()) ??
      "";
    childHarness.getContext().setInceptionOverride([
      personaMsg,
      {
        role: "system",
        content: coreStr + (dyn.trim() ? `\n\n${dyn.trim()}` : ""),
      },
      ...subtaskTail,
    ]);

    // ── Register in orchestrator ────────────────────────────────────────────
    this.orchestrator.register({
      taskId: childId,
      parentTaskId: this.taskId,
      goal: childConfig.goal,
      depth: childDepth,
      startedAt: Date.now(),
      status: "running",
      abortController,
    });

    // ── Emit spawned event ──────────────────────────────────────────────────
    this.emitter.emit("subtask_spawned", {
      taskId: childId,
      parentTaskId: this.taskId,
      goal: childConfig.goal,
      depth: childDepth,
    });

    // Forward child text output to parent as subtask_output events (live streaming)
    childHarness.emitter.on("text", ({ delta }) => {
      this.emitter.emit("subtask_output", { taskId: childId, delta });
    });

    // ── Run child asynchronously ────────────────────────────────────────────
    const timeoutMs = childConfig.timeoutMs ?? 300_000;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const promise: Promise<SubtaskResult> = new Promise<SubtaskResult>(
      (resolve) => {
        // Set up timeout cancellation
        timeoutId = setTimeout(() => {
          this.orchestrator.cancel(childId);
        }, timeoutMs);

        childHarness
          .send(childConfig.goal)
          .then(() => {
            clearTimeout(timeoutId);
            const output = childHarness.getLastAssistantMessage();
            this.orchestrator.complete(childId, output);
            this.emitter.emit("subtask_complete", {
              taskId: childId,
              ok: true,
              output,
              rounds: childHarness.roundCount,
            });
            resolve({
              taskId: childId,
              ok: true,
              output,
              rounds: childHarness.roundCount,
            });
          })
          .catch((err: unknown) => {
            clearTimeout(timeoutId);
            const errMsg = err instanceof Error ? err.message : String(err);
            this.orchestrator.fail(childId, errMsg);
            this.emitter.emit("subtask_complete", {
              taskId: childId,
              ok: false,
              output: errMsg,
              rounds: childHarness.roundCount,
            });
            resolve({
              taskId: childId,
              ok: false,
              output: errMsg,
              rounds: childHarness.roundCount,
            });
          });
      }
    );

    return { taskId: childId, promise };
  }

  /** Episodic vault chunk (Obsidian) — one note per completed send when vault path is set. */
  private async maybePersistEpisodeTurn(): Promise<void> {
    if (process.env["AGENT_MEMORY_EPISODE"] === "0") return;
    if (this.agentDepth > 0) return;
    if (!process.env["AGENT_VAULT_PATH"]?.trim()) return;
    if (!this.registry.has("vault_write")) return;
    const title = `Episode ${new Date().toISOString().replace(/[:.]/g, "-")}`;
    const body =
      `## Session turn\n\n` +
      `- User (truncated): ${this.lastUserMessage.slice(0, 1200)}\n\n` +
      `- Distinct tools: ${[...new Set(this.toolsUsedThisTurn)].join(", ") || "(none)"}\n\n` +
      `- ReAct rounds this send: ${this.roundCount}\n`;
    try {
      await this.dispatcher.directCall("vault_write", {
        title,
        content: body,
        type: "episode",
        tags: ["auto-harness"],
      });
    } catch {
      /* optional */
    }
  }

  /** MemReader-style extraction into typed remember() entries (env-gated). */
  private async maybeAutoExtractMemories(): Promise<void> {
    if (process.env["AGENT_MEMORY_AUTO_EXTRACT"] === "0") return;
    if (this.agentDepth > 0) return;
    if (!this.registry.has("remember")) return;
    if (this.toolsUsedThisTurn.length === 0) return;

    const payload =
      `User:\n${this.lastUserMessage.slice(0, 2000)}\n\n` +
      `Tools used this send:\n${this.toolsUsedThisTurn.join(", ")}\n\n` +
      `Last assistant:\n${(this.context.getLastAssistantMessage() ?? "").slice(0, 3000)}`;

    try {
      const fast = getFastModelSlug(this.config.model);
      const jr = await completeChatJson(this.client, {
        model: fast,
        temperature: 0,
        maxTokens: 500,
        messages: [
          {
            role: "system",
            content:
              "Extract 0-5 durable memories for an agent JSON note store. Reply JSON only: " +
              '{"memories":[{"type":"fact|entity|experience","key":"short_snake_case","value":"text"}]}. ' +
              "Omit memories that are trivial or already implied. Empty array if nothing worth persisting.",
          },
          { role: "user", content: payload },
        ],
      });
      if (!jr.ok || typeof jr.parsed !== "object" || jr.parsed === null) return;
      const parsed = jr.parsed as {
        memories?: Array<{ type?: string; key?: string; value?: string }>;
      };
      const mems = parsed.memories ?? [];
      const allowed = new Set(["fact", "entity", "experience", "belief", "reflection", "recipe"]);
      for (const item of mems.slice(0, 5)) {
        if (!item?.key || !item?.value) continue;
        const typ = item.type;
        if (typ && !allowed.has(typ)) continue;
        try {
          await this.dispatcher.directCall("remember", {
            key: item.key.slice(0, 80),
            value: item.value.slice(0, 4000),
            ...(typ ? { type: typ } : {}),
          });
        } catch {
          /* duplicate / schema */
        }
      }
    } catch {
      /* ignore */
    }
  }

  private async maybeAutoWriteVaultNotes(): Promise<void> {
    if (this.agentDepth > 0) return;
    const mode = resolveVaultAutoWriteMode();
    if (mode === "off") return;
    if (!this.registry.has("vault_write")) return;
    const hasResearchSignals =
      this.isLikelyKnowledgeTask() ||
      this.toolsUsedThisTurn.includes("web_search") ||
      this.toolsUsedThisTurn.includes("web_fetch");
    if (mode === "research" && !hasResearchSignals) return;
    if (mode === "aggressive" && this.toolsUsedThisTurn.length < 3) return;
    const assistant = (this.context.getLastAssistantMessage() ?? "").trim();
    if (assistant.length < (mode === "aggressive" ? 120 : 80)) return;
    const budget = Math.max(
      1,
      Math.min(20, parseInt(process.env["AGENT_VAULT_WRITE_BUDGET"] ?? "8", 10) || 8)
    );
    const existingWrites = this.toolsUsedThisTurn.filter((t) => t === "vault_write").length;
    if (existingWrites >= budget) return;

    const dateKey = new Date().toISOString().slice(0, 10);
    const title = `Knowledge ${dateKey} ${hashString(this.lastUserMessage).slice(0, 8)}`;
    const evidence = this.evidenceLog
      .slice(-4)
      .map((e) => `- ${e.name}: ${e.excerpt.replace(/\n/g, " ").slice(0, 180)}`)
      .join("\n");
    const tools = [...new Set(this.toolsUsedThisTurn)].slice(0, 12).join(", ");
    const body =
      `## Summary\n${assistant.slice(0, 1400)}\n\n` +
      `## Evidence\n${evidence || "- (no explicit evidence excerpts captured)"}\n\n` +
      `## Runtime\n- Tools used: ${tools}\n- Rounds: ${this.roundCount}\n\n` +
      `## Next links\n- [[Tasks]]\n- [[Agent Runtime]]`;

    const dedupeOn = process.env["AGENT_VAULT_DEDUPE"] !== "0";
    if (dedupeOn && this.registry.has("vault_search")) {
      const search = await this.dispatcher.directCall("vault_search", {
        query: this.lastUserMessage.slice(0, 120),
      });
      if (search.ok && /Found\s+[1-9]/i.test(search.output)) {
        this.vaultMetrics.skippedWrites += 1;
        this.emitter.emit("vault_activity", {
          action: "skip_write",
          ok: true,
          reason: "dedupe_preflight_found_existing_note",
        });
        return;
      }
    }

    const wr = await this.dispatcher.directCall("vault_write", {
      title,
      content: body,
      type: "note",
      tags: ["auto-wiki", "knowledge", "harness"],
    });
    if (wr.ok) {
      this.vaultMetrics.writes += 1;
      this.emitter.emit("vault_activity", {
        action: "write",
        ok: true,
        noteTitle: title,
      });
    } else {
      this.vaultMetrics.skippedWrites += 1;
      this.emitter.emit("vault_activity", {
        action: "skip_write",
        ok: false,
        noteTitle: title,
        reason: wr.error,
      });
    }
  }

  private buildHarnessMetrics(reason: TurnEndTerminationReason): TurnEndHarnessMetrics {
    return {
      terminationReason: reason,
      toolsInvokedThisSend: [...new Set(this.toolsUsedThisTurn)],
      spawnAgentCallsThisSend: this.toolsUsedThisTurn.filter((n) => n === "spawn_agent").length,
      parallelToolCallsLastBatch: this.lastParallelToolBatchSize,
      workingStatePreview: this.context.getWorkingStateBlock().trim().slice(0, 400),
      epistemicState: this.context.getEpistemicState() ?? undefined,
      executionState: this.executionState ?? undefined,
      vaultMetrics: { ...this.vaultMetrics },
    };
  }

  /** Emit a single turn_end per send() with telemetry (idempotent). */
  private emitTurnEnd(reason: TurnEndTerminationReason): void {
    if (this.turnEndEmittedThisSend) return;
    this.turnEndEmittedThisSend = true;
    const snapshot = this.context.snapshot();
    this.emitter.emit("turn_end", {
      contextSnapshot: snapshot,
      durationMs: Date.now() - this.sendStartTime,
      harnessMetrics: this.buildHarnessMetrics(reason),
    });
  }

  private async runReActLoop(round = 0): Promise<void> {
    // Check abort signal (set when orchestrator cancels this task)
    if (this.abortSignal?.aborted) return;

    if (round >= this.config.maxToolRoundsPerTurn) {
      this.emitTurnEnd("round_cap");
      this.emitter.emit("error", {
        err: new Error(
          `Max tool rounds (${this.config.maxToolRoundsPerTurn}) exceeded`
        ),
      });
      return;
    }

    this.roundCount = round + 1;
    if (this.executionState) {
      this.emitter.emit("runtime_heartbeat", {
        round: this.roundCount,
        uptimeMs: Date.now() - this.sendStartTime,
        activeContractId: this.executionState.activeContractId,
        driftScore: this.executionState.driftScore,
      });
      if (this.roundCount > 1 && this.roundCount % 4 === 0) {
        const next = updateDriftScore(this.executionState, 0.06);
        const triggeredReplan = next.driftScore >= 0.55;
        this.executionState = triggeredReplan ? advanceExecutionStateForPlan(next, [
          "Reconfirm mission objective and constraints",
          "Regenerate milestone contracts from latest evidence",
          "Continue execution under refreshed contracts",
        ]) : next;
        this.emitter.emit("drift_detected", {
          score: this.executionState.driftScore,
          reason: "periodic anti-drift cadence",
          triggeredReplan,
        });
      }
    }

    if (
      round === 1 &&
      process.env["AGENT_RULE_RECALL"] !== "0" &&
      !this.ruleRecallInjectedThisSend
    ) {
      this.ruleRecallInjectedThisSend = true;
      this.context.appendMessage({
        role: "system",
        content: HARNESS_RULE_RECALL_MESSAGE,
      });
    }

    if (
      process.env["AGENT_FINALIZE_HINT"] === "1" &&
      !this.finalizeHintInjectedThisSend &&
      this.roundCount >= Math.max(1, Math.ceil(0.7 * this.config.maxToolRoundsPerTurn))
    ) {
      this.finalizeHintInjectedThisSend = true;
      this.context.appendMessage({
        role: "user",
        content:
          "[SYSTEM NOTE] You are past ~70% of the tool-round budget for this turn. " +
          "Stop calling tools unless strictly necessary and produce your final answer soon.",
      });
    }

    this.context.refreshProtocolDynamic(this.registry.getActiveToolNames());

    // Context pressure alerts (#9): fire once per threshold per turn
    const snapBefore = this.context.snapshot();
    const pctBefore = Math.round(snapBefore.usageFraction * 100);
    if (pctBefore >= 85 && !this.contextAlertFired85) {
      this.contextAlertFired85 = true;
      this.context.appendMessage({
        role: "user",
        content: `[CONTEXT BUDGET CRITICAL: ${pctBefore}% used — call compress_context() immediately or early context will be lost.]`,
      });
    } else if (pctBefore >= 60 && !this.contextAlertFired60) {
      this.contextAlertFired60 = true;
      this.context.appendMessage({
        role: "user",
        content: `[CONTEXT BUDGET: ${pctBefore}% used — consider calling compress_context() before continuing long tasks.]`,
      });
    }

    if (
      !this.proactiveCompressedThisSend &&
      pctBefore >= 65 &&
      this.roundCount >= 2
    ) {
      const anchor = `Proactive compress at ~${pctBefore}% — recent tools: ${[
        ...new Set(this.toolsUsedThisTurn),
      ]
        .slice(-10)
        .join(", ")}`;
      this.context.forceCompress(anchor);
      this.proactiveCompressedThisSend = true;
    }

    const recallEvery = parseInt(process.env["AGENT_RECALL_EVERY_N"] ?? "2", 10);
    if (
      recallEvery > 0 &&
      round > 0 &&
      round % recallEvery === 0 &&
      this.agentDepth === 0 &&
      (this.registry.has("recall_relevant") || this.registry.has("memory_query"))
    ) {
      try {
        const seed = this.lastUserMessage.trim().slice(0, 400);
        const rw = this.recallRewriteThisSend;
        const sub =
          rw?.subQueries?.filter((q) => q.trim().length >= 4) ?? [];
        const queries = sub.length > 0 ? sub : seed.length >= 8 ? [seed] : [];
        if (queries.length > 0) {
          const k = Math.min(
            8,
            Math.max(3, this.context.getContextBudgetAdvice().recommendedRecallK)
          );
          const useMq = this.registry.has("memory_query");
          const payload: Record<string, unknown> = useMq
            ? {
                mode: "hybrid",
                query: queries[0]!.slice(0, 800),
                queries,
                k,
                scope: "both",
                goal_hint: this.lastUserMessage.slice(0, 500),
                open_questions:
                  rw?.subQueries?.filter((q) => q.trim().length >= 4).slice(0, 8) ?? [],
              }
            : {
                query: queries[0]!.slice(0, 800),
                queries,
                k,
                scope: "both",
              };
          if (rw?.hyde?.trim()) payload["hyde"] = rw.hyde.trim().slice(0, 1500);
          const r = await this.dispatcher.directCall(useMq ? "memory_query" : "recall_relevant", payload);
          if (r.ok && typeof r.output === "string" && r.output.trim().length > 20) {
            this.context.appendMessage({
              role: "user",
              content: `[Relevant memory — mid-turn recall]\n${r.output.slice(0, 3500)}`,
            });
          }
        }
      } catch {
        /* optional */
      }
    }

    const messages = this.context.buildMessages();
    const tools = this.registry.toOpenAIFormat();
    const accumulator = new StreamAccumulator();

    const stream = await this.streamWithRetry(messages, tools);

    let finishReason: string | null = null;

    for await (const chunk of stream) {
      // Check abort between chunks
      if (this.abortSignal?.aborted) return;

      const parsed = accumulator.processChunk(chunk);

      if (parsed.textDelta) {
        this.emitter.emit("text", { delta: parsed.textDelta, channel: "user" });
      }

      if (parsed.toolCallDelta) {
        const { index, id, name, argsDelta } = parsed.toolCallDelta;

        if (parsed.isNewTool && id && name) {
          this.emitter.emit("tool_start", { callId: id, name });
        }

        if (argsDelta) {
          const tc = accumulator.accumulatedToolCalls[index];
          if (tc) {
            this.emitter.emit("tool_delta", { callId: tc.id, argsDelta });
          }
        }
      }

      if (parsed.finishReason) {
        finishReason = parsed.finishReason;
      }
    }

    const toolCalls = accumulator.accumulatedToolCalls;
    const assistantMessage = this.buildAssistantMessage(
      accumulator.accumulatedText,
      toolCalls
    );

    if (
      finishReason === "length" &&
      toolCalls.length === 0 &&
      this.lengthResumeRemaining > 0
    ) {
      this.lengthResumeRemaining--;
      this.context.append(assistantMessage);
      this.context.appendMessage({
        role: "user",
        content:
          "[CONTINUE] The previous assistant message was cut off (length limit). " +
          "Continue exactly where you left off and finish.",
      });
      await this.runReActLoop(round);
      return;
    }

    this.context.append(assistantMessage);

    if (finishReason === "tool_calls" && toolCalls.length > 0) {
      // Collect tool names for pre-flight dangerLevel checks
      const batchToolNames = toolCalls.map((tc) => tc.name);

      const repIdx = (() => {
        const rep = new Array<number>(toolCalls.length);
        const firstIdxByKey = new Map<string, number>();
        for (let i = 0; i < toolCalls.length; i++) {
          const tc = toolCalls[i]!;
          const k = `${tc.name}:${stableArgsJsonKey(tc.argsJson)}`;
          const fi = firstIdxByKey.get(k);
          if (fi === undefined) {
            firstIdxByKey.set(k, i);
            rep[i] = i;
          } else {
            rep[i] = fi;
          }
        }
        return rep;
      })();

      const results: ToolResult[] = new Array(toolCalls.length);
      await Promise.all(
        toolCalls.map(async (tc, i) => {
          if (repIdx[i] !== i) return;
          results[i] = await this.dispatcher.dispatch(tc.id, tc.name, tc.argsJson, batchToolNames);
        })
      );
      for (let i = 0; i < toolCalls.length; i++) {
        if (repIdx[i] === i) continue;
        const src = results[repIdx[i]!]!;
        results[i] = src;
        const tc = toolCalls[i]!;
        let dupArgs: Record<string, unknown> = {};
        try {
          dupArgs = JSON.parse(tc.argsJson) as Record<string, unknown>;
        } catch {
          /* ignore */
        }
        this.emitter.emit("tool_result", {
          callId: tc.id,
          name: tc.name,
          args: dupArgs,
          result: src,
        });
      }

      // Track tools used this turn (for recipe recording)
      for (const tc of toolCalls) {
        this.toolsUsedThisTurn.push(tc.name);
      }
      this.lastParallelToolBatchSize = toolCalls.length;

      for (let i = 0; i < toolCalls.length; i++) {
        const tc = toolCalls[i]!;
        const r = results[i]!;
        const line = `${tc.name}:${r.ok ? "ok" : "fail"}`;
        this.recentToolOutcomeLines.push(line.slice(0, 160));
        if (this.recentToolOutcomeLines.length > 3) this.recentToolOutcomeLines.shift();
        if (r.ok && tc.name === "read_file") {
          try {
            const a = JSON.parse(tc.argsJson) as { path?: string };
            if (a.path) {
              this.filesReadThisTurn.push(a.path);
              if (this.filesReadThisTurn.length > 24) this.filesReadThisTurn.shift();
            }
          } catch {
            /* ignore */
          }
        }
        if (tc.name === "vault_read") {
          if (r.ok) this.vaultMetrics.reads += 1;
          this.emitter.emit("vault_activity", {
            action: "read",
            ok: r.ok,
            reason: r.ok ? undefined : r.error,
          });
        } else if (tc.name === "vault_search") {
          if (r.ok) this.vaultMetrics.searches += 1;
          this.emitter.emit("vault_activity", {
            action: "search",
            ok: r.ok,
            reason: r.ok ? undefined : r.error,
          });
        } else if (tc.name === "vault_write") {
          if (r.ok) this.vaultMetrics.writes += 1;
          else this.vaultMetrics.skippedWrites += 1;
          this.emitter.emit("vault_activity", {
            action: r.ok ? "write" : "skip_write",
            ok: r.ok,
            reason: r.ok ? undefined : r.error,
          });
        } else if (tc.name === "web_search") {
          try {
            const a = JSON.parse(tc.argsJson) as { query?: string };
            if (typeof a.query === "string" && a.query.trim().length >= 4) {
              const q = a.query.trim();
              if (!this.webSearchQueriesThisTurn.some((x) => normalizeIntentText(x) === normalizeIntentText(q))) {
                this.webSearchQueriesThisTurn.push(q);
              }
              if (!r.ok) {
                const key = normalizeIntentText(q);
                this.failedSearchIntentCounts.set(key, (this.failedSearchIntentCounts.get(key) ?? 0) + 1);
              }
            }
          } catch {
            /* ignore */
          }
        }
      }

      if (this.config.workingStateEnabled !== false && this.context.getEpistemicState()) {
        for (let i = 0; i < toolCalls.length; i++) {
          const tc = toolCalls[i]!;
          const r = results[i]!;
          if (!r.ok) continue;
          if (tc.name === "plan") {
            try {
              const args = JSON.parse(tc.argsJson) as {
                steps?: string[];
                step_index?: number;
              };
              if (args.steps && args.steps.length > 0) {
                this.context.patchEpistemicState({ subgoals: subgoalsFromPlanSteps(args.steps) });
                if (this.executionState) {
                  this.executionState = advanceExecutionStateForPlan(this.executionState, args.steps);
                  const cid = this.executionState.activeContractId;
                  if (cid) {
                    this.emitter.emit("contract_transition", {
                      contractId: cid,
                      status: "active",
                      reason: "plan() created/updated execution contracts",
                    });
                  }
                }
              } else if (typeof args.step_index === "number") {
                const cur = this.context.getEpistemicState()?.subgoals ?? [];
                this.context.patchEpistemicState({
                  subgoals: markEpistemicPlanStepDone(cur, args.step_index),
                });
                if (this.executionState) {
                  const target = this.executionState.contracts[args.step_index];
                  if (target) {
                    this.executionState = markExecutionContractStatus(
                      this.executionState,
                      target.id,
                      "verified"
                    );
                    this.emitter.emit("contract_transition", {
                      contractId: target.id,
                      status: "verified",
                      reason: "plan step marked complete",
                    });
                    const next = this.executionState.contracts.find((c) => c.status === "planned");
                    if (next) {
                      this.executionState = markExecutionContractStatus(
                        this.executionState,
                        next.id,
                        "active"
                      );
                      this.emitter.emit("contract_transition", {
                        contractId: next.id,
                        status: "active",
                        reason: "advance to next planned contract",
                      });
                    }
                  }
                }
              }
            } catch {
              /* ignore bad plan args */
            }
          }
          if (tc.name === "extract_structured") {
            const out = r.output.trim();
            if (out.startsWith("{")) {
              try {
                const parsed = JSON.parse(out) as Record<string, unknown>;
                const merged = mergeExtractedSubgoals(
                  this.context.getEpistemicState()?.subgoals ?? [],
                  parsed["subgoals"]
                );
                if (merged) this.context.patchEpistemicState({ subgoals: merged });
              } catch {
                /* not JSON */
              }
            }
          }
        }
      }

      if (this.config.workingStateEnabled !== false) {
        const outcomes = toolCalls
          .map((tc, i) => {
            const r = results[i]!;
            return `${tc.name}:${r.ok ? "ok" : "fail"}`;
          })
          .join("; ");
        const budget = this.context.getContextBudgetAdvice();
        const rwq = this.recallRewriteThisSend;
        const fromRewrite =
          rwq?.subQueries?.map((q) => q.trim()).filter((q) => q.length >= 4).slice(0, 8) ?? [];
        const caps = this.lastUserMessage.match(/\b[A-Z][a-z]{4,}[a-zA-Z]*\b/g);
        const capsQs = caps ? [...new Set(caps)].slice(0, 8) : [];
        const openQs = fromRewrite.length > 0 ? fromRewrite : capsQs;
        const harnessNotes =
          `LAST PARALLEL BATCH (${toolCalls.length}): ${batchToolNames.join(", ")}\n` +
          `OUTCOMES: ${outcomes}\n` +
          `RECENT TOOL LINES: ${this.recentToolOutcomeLines.join(" · ")}\n` +
          `SPAWN_AGENT CALLS THIS SEND: ${this.toolsUsedThisTurn.filter((n) => n === "spawn_agent").length}`;
        this.context.patchEpistemicState({
          goal:
            this.lastUserMessage.slice(0, 500) +
            (this.lastUserMessage.length > 500 ? "…" : ""),
          filesTouched: [...this.filesReadThisTurn],
          openQuestions: openQs,
          budget: {
            usagePct: Math.round(budget.usageFraction * 100),
            recallK: budget.recommendedRecallK,
            spareRounds: budget.suggestedMaxExtraRounds,
          },
          harnessNotes,
        });
      }
      if (this.executionState) {
        this.emitter.emit("execution_state", {
          missionId: this.executionState.mission?.id,
          activeContractId: this.executionState.activeContractId,
          driftScore: this.executionState.driftScore,
          milestoneCount: this.executionState.milestones.length,
          contractCount: this.executionState.contracts.length,
        });
      }

      // Tell dispatcher which tools ran this round so the NEXT round's
      // pre-flight check can see if think() just fired (#10 danger pre-flight fix)
      this.dispatcher.notifyBatchComplete(batchToolNames);

      for (let i = 0; i < toolCalls.length; i++) {
        const tc = toolCalls[i] as AccumulatedToolCall;
        const result = results[i]!;
        const rawOut = result.ok ? result.output : "";
        if (result.ok && isEvidenceToolName(tc.name) && rawOut.length > 0) {
          this.evidenceLog.push({
            toolCallId: tc.id,
            name: tc.name,
            hash: hashString(rawOut.slice(0, 12_000)),
            excerpt: rawOut.slice(0, 1200),
          });
        }
        let content = result.ok ? result.output : `ERROR: ${result.error}`;
        if (result.ok && shouldDistillToolOutput(tc.name, content)) {
          try {
            const d = await distillToolOutput(
              this.client,
              this.config.model,
              tc.name,
              tc.argsJson,
              content
            );
            content = d.display;
          } catch (err) {
            void appendFailureLog({
              category: "distill_error",
              tool: tc.name,
              message: err instanceof Error ? err.message : String(err),
            });
          }
        }
        this.context.append({
          role: "tool",
          tool_call_id: tc.id,
          content,
        });
      }

      await this.context.elideStaleToolResults();

      // Per-tool error tracking + adaptive hints (#8)
      for (let i = 0; i < toolCalls.length; i++) {
        const tc = toolCalls[i] as AccumulatedToolCall;
        const result = results[i]!;
        if (!result.ok) {
          const prevCount = this.toolErrorCounts.get(tc.name) ?? 0;
          this.toolErrorCounts.set(tc.name, prevCount + 1);
          if (prevCount >= 1) {
            // Use unified error taxonomy hint (#9)
            this.context.appendMessage({
              role: "user",
              content: buildAdaptiveHint(tc.name, prevCount + 1),
            });
          }
        }
      }

      // Error recovery injection: if ALL tools failed, inject a structured hint + reflexion (#2)
      const allFailed = results.every((r) => !r.ok);
      if (allFailed) {
        const errorSummary = toolCalls
          .map((tc, i) => {
            const r = results[i]!;
            return `${tc.name}: ${!r.ok ? r.error : ""}`;
          })
          .join("; ");
        void appendFailureLog({
          category: "all_tools_failed",
          round: this.roundCount,
          errors: errorSummary.slice(0, 2000),
        });
        const hint = buildRecoveryHint(errorSummary);
        this.context.append({
          role: "user",
          content:
            `[SYSTEM NOTE] All tool calls in the last round failed.\n` +
            `Errors: ${errorSummary}\n` +
            `${hint}\n` +
            `Reassess and try a different approach — do NOT retry with identical arguments.`,
        });
        if (this.executionState) {
          this.executionState = updateDriftScore(this.executionState, 0.15);
          this.executionState = appendRecoveryRecord(this.executionState, {
            at: Date.now(),
            reason: "all_tools_failed",
            strategy: "replan",
            notes: errorSummary.slice(0, 500),
          });
          this.emitter.emit("recovery_action", {
            strategy: "replan",
            reason: "all tool calls failed in current round",
            notes: errorSummary.slice(0, 200),
          });
        }

        // Reflexion auto-persist (#2 VIGIL): awaited with error boundary — no silent swallowing
        if (this.registry.has("remember")) {
          const reflectionKey = `reflection:${hashString(this.lastUserMessage).slice(0, 12)}`;
          const reflectionValue =
            `[Round ${this.roundCount}] All tools failed. ` +
            `Errors: ${errorSummary.slice(0, 200)}. ` +
            `Task: ${this.lastUserMessage.slice(0, 80)}`;
          try {
            await this.dispatcher.directCall("remember", { key: reflectionKey, value: reflectionValue });
          } catch (err) {
            this.emitter.emit("text", {
              delta: `\n[HARNESS] Reflexion persist failed: ${err instanceof Error ? err.message : String(err)}\n`,
              channel: "trace",
            });
          }
        }
      }

      await this.runReActLoop(round + 1);
    } else {
      let assistantText = "";
      if (typeof assistantMessage.content === "string") {
        assistantText = normalizeSearchDelta(assistantMessage.content);
      }
      const criticMinTools = parseInt(process.env["AGENT_CRITIC_MIN_TOOLS"] ?? "4", 10);
      const distinctToolCount = new Set(this.toolsUsedThisTurn).size;
      const runForcedCritic =
        process.env["AGENT_CRITIC_REQUIRE"] === "1" &&
        !this.criticConsumedThisSend &&
        this.agentDepth === 0 &&
        this.registry.has("verify_result") &&
        (distinctToolCount >= criticMinTools || looksPathOrCodeHeavy(assistantText));
      const runHeuristicCritic =
        process.env["AGENT_CRITIC"] === "1" &&
        !this.criticConsumedThisSend &&
        this.roundCount >= 3 &&
        this.agentDepth === 0 &&
        this.registry.has("verify_result") &&
        shouldRunCriticPass(assistantText);

      if (runForcedCritic || runHeuristicCritic) {
        this.criticConsumedThisSend = true;
        try {
          const vr = await this.dispatcher.directCall("verify_result", {
            goal: this.lastUserMessage.slice(0, 2000),
            result: assistantText.slice(0, 12_000),
            ...(process.env["AGENT_CRITIC_EVIDENCE"] === "1"
              ? { evidence_pack: this.getEvidencePackForCritic() }
              : {}),
          });
          if (
            vr.ok &&
            typeof vr.output === "string" &&
            (/ISSUES\s+FOUND|✗\s*ISSUES/i.test(vr.output) || /✗/.test(vr.output))
          ) {
            void appendFailureLog({
              category: "critic_issues",
              preview: vr.output.slice(0, 800),
            });
            this.context.appendMessage({
              role: "user",
              content: `[CRITIC NOTES]\n${vr.output.slice(0, 4000)}`,
            });
            await this.runReActLoop(round);
            return;
          }
        } catch {
          /* optional */
        }
      }

      const trimmedFinal = assistantText.trim();
      const doneish =
        /^(OK|DONE)\b/i.test(trimmedFinal) || /\b(done|ok)\b\s*[.!]?\s*$/i.test(trimmedFinal);
      if (
        process.env["AGENT_FINALIZE_CITE"] !== "0" &&
        doneish &&
        this.filesReadThisTurn.length > 0 &&
        !assistantCitesPath(assistantText, this.filesReadThisTurn) &&
        !this.finalizeCiteNudgeThisSend
      ) {
        this.finalizeCiteNudgeThisSend = true;
        this.context.appendMessage({
          role: "user",
          content:
            "[FINALIZE NOTE] Your reply looks finished, but cite at least one real path string " +
            "that appeared in read_file / repo_map / list_dir output (exact substring) before ending.",
        });
        await this.runReActLoop(round);
        return;
      }

      const isResearchTask =
        this.isLikelyKnowledgeTask() &&
        this.toolsUsedThisTurn.includes("web_search") &&
        !this.finalizeSynthesisNudgeThisSend;
      if (isResearchTask) {
        const hasTimeline = /\b(chronology|timeline|sequence|on\s+\w+\s+\d{1,2}|recently|earlier)\b/i.test(
          assistantText
        );
        const sourceMentions =
          (assistantText.match(/https?:\/\/|reuters|bbc|ap|al jazeera|wikipedia|france24|guardian|nyt/gi) ?? [])
            .length;
        const hasUncertainty = /\b(uncertain|unverified|fragile|confidence|may change|developing)\b/i.test(
          assistantText
        );
        const hasOpenItems = /\b(open question|unknown|unresolved|to confirm|not yet clear)\b/i.test(
          assistantText
        );
        if (!hasTimeline || sourceMentions < 2 || !hasUncertainty || !hasOpenItems) {
          this.finalizeSynthesisNudgeThisSend = true;
          this.context.appendMessage({
            role: "user",
            content:
              "[SYNTHESIS CHECKLIST] Before finalizing research output, include: " +
              "(1) a short timeline/sequence, (2) multi-source grounding (>=2 sources), " +
              "(3) explicit uncertainty/fragility note for fast-moving facts, and (4) unresolved items.",
          });
          await this.runReActLoop(round);
          return;
        }
      }

      await this.maybePersistEpisodeTurn();
      await this.maybeAutoWriteVaultNotes();
      await this.maybeAutoExtractMemories();
      this.emitTurnEnd("ok");
    }
  }

  private async streamWithRetry(
    messages: Message[],
    tools: OpenAI.Chat.Completions.ChatCompletionTool[]
  ): Promise<Stream<OpenAI.Chat.Completions.ChatCompletionChunk>> {
    let lastErr: unknown;

    const allowToollessRetry = this.config.allowToollessStreamRetry !== false;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const useTools =
        tools.length > 0 && (allowToollessRetry ? attempt < 2 : true);
      const useToolChoice = useTools && attempt === 0;

      const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
        model: this.config.model,
        messages,
        stream: true,
        ...(useTools && { tools }),
        ...(useToolChoice && { tool_choice: "auto" as const }),
      };

      try {
        // Pass abort signal as RequestOptions (second arg) so hung streams can be cancelled (#3)
        return (await this.client.chat.completions.create(
          params,
          ...(this.abortSignal ? [{ signal: this.abortSignal }] : [])
        )) as Stream<OpenAI.Chat.Completions.ChatCompletionChunk>;
      } catch (err) {
        lastErr = err;
        const msg = describeError(err);

        if (!isRetryable(err) || attempt === this.maxRetries) {
          throw new Error(msg);
        }

        const delay = this.retryDelayMs * Math.pow(2, attempt);
        this.emitter.emit("provider_retry", {
          attempt: attempt + 1,
          maxAttempts: this.maxRetries + 1,
          message: msg,
          backoffMs: delay,
        });
        if (!isUiQuiet()) {
          this.emitter.emit("text", {
            delta: `\n⟳ ${msg} — retrying in ${Math.round(delay / 1000)}s (attempt ${attempt + 1}/${this.maxRetries})…\n`,
          });
        }

        await sleep(delay);
      }
    }

    throw new Error(describeError(lastErr));
  }

  private buildAssistantMessage(
    text: string,
    toolCalls: AccumulatedToolCall[]
  ): Message {
    if (toolCalls.length === 0) {
      return { role: "assistant", content: text || "" };
    }
    return {
      role: "assistant",
      content: text || null,
      tool_calls: toolCalls.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.name, arguments: tc.argsJson },
      })),
    };
  }

  /**
   * Clear conversation state. Persona override is preserved; call resetPersona() to clear it.
   * World context will be re-injected on the next root send() (same as a fresh session).
   */
  reset(): void {
    this.context.clear();
    this.roundCount = 0;
    this.worldContextInjected = false;
  }
}
