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
  TurnSummary,
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
import { gatherRepoMapLines } from "./repo_map.js";
import {
  rewriteQueryForRecall,
  rewriteQueryForIdentityRecall,
  type RewriteQueryResult,
} from "./query_rewrite.js";
import { distillToolOutput, shouldDistillToolOutput } from "./output_distill.js";
import { appendFailureLog } from "./failure_log.js";
import { completeChatJson, getFastModelSlug } from "./router.js";
import { stableArgsJsonKey } from "./json_stable.js";
import { buildHarnessRuleRecallMessage } from "./harness_rules.js";
import {
  batchHasUndispatchableFileWrites,
  fileWriteSafeToDispatch,
  isFileWriteToolName,
  LENGTH_RESUME_FILE_WRITE_MESSAGE,
  shouldDispatchToolBatch,
  shouldEagerDispatchWhenArgsComplete,
  tryParseToolArgs,
} from "./file_write_resume.js";
import {
  discardFileWriteStreamManifest,
  setFileWriteStreamManifest,
} from "./file_write_stream_manifest.js";
import {
  FileWriteStreamSink,
  resolveWriteStreamSinkEnabled,
  resolveWriteStreamSinkMinChars,
} from "./file_write_stream_sink.js";
import { recordRecipe } from "./recipe_library.js";
import { addCompressionGuideline, formatCompressionGuidelines } from "./compression_guidelines.js";
import { bumpRuleHits, getRuleHitCounts, extractRuleIds, recordRuleOutcomes, getDemotedRuleIds } from "./rule_stats.js";
import { writeYieldSnapshot } from "./session_event_log.js";
import { SharedMemoryBus } from "./shared_memory_bus.js";
import { resolveProviderConfig, buildProviderRouting } from "./provider_config.js";
import { applyPromptCacheBreakpoints, extractCachedTokens } from "./prompt_cache.js";
import { buildOpenRouterAttributionHeaders } from "./openrouter_attribution.js";
import { withProviderRequestSpacing } from "./provider_request_gate.js";
import type { RuntimePreferences, RuntimePersonaProfile } from "./runtime_prefs.js";
import {
  runHarnessEffectiveEnvContext,
  effectiveHarnessEnvRaw,
  resolveHarnessEnvRaw,
} from "./harness_effective_env.js";
import { HARNESS_MANAGED_ENV_KEY_SET, HARNESS_SECRET_ENV_KEYS } from "./harness_env_inventory.js";
import {
  applyPersonaControlsToProfile,
  buildRuntimePersonaBlock,
  normalizePersonaControlsPatch,
  personaConfigFromRuntimeProfile,
} from "./runtime_persona_controls.js";
import {
  buildAutoDreamPrompt,
  buildAutoDreamTranscriptMessage,
  listSessionsTouchedSince,
  loadRecentSessionSnippets,
  readLastConsolidatedAt,
  resolveAutoDreamConfig,
  resolveAutoDreamInjectTranscript,
  rollbackConsolidationLock,
  tryAcquireConsolidationLock,
} from "./auto_dream.js";
import {
  appendPersonalityHeartbeatLog,
  executePersonalityHeartbeat,
  resolvePersonalityHeartbeatConfig,
} from "./personality_heartbeat.js";
import { readFile as readFileFs } from "node:fs/promises";
import path from "node:path";
import { resolveWorkspaceRoot, runWithWorkspaceRoot } from "./workspace_root.js";
import { runWithChatId } from "./chat_context.js";
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
  getCompensationLedger,
  recordCompensation,
  renderExecutionStateBlock,
} from "./execution_state.js";
import {
  inferCompensationAction,
  formatCompensationReport,
  snapshotFileForCompensation,
} from "./compensation_ledger.js";
import { mapContractToToolFamilies } from "./contract_tool_mapper.js";
import {
  shouldSkipHarnessSecondaryPassesForTurn,
  applyTurnInferenceHeuristics,
  inferTurnInference,
  neutralTurnInferenceResult,
  resolveMemoryPolicy,
  buildRoutingProfile,
  type IntentInferenceWorkspaceContext,
  type TurnInferenceResult,
  type RoutingProfile,
} from "./intent_inference.js";
import {
  buildOpenRouterReasoningParam,
  buildReasoningBudgetInjection,
  formatReasoningBudgetTraceLine,
  resolveReasoningBudget,
  tightenReasoningBudgetForUserMessage,
  type ReasoningBudget,
  type ReasoningIntentClass,
} from "./reasoning_profile.js";
import {
  applySurfaceToBudget,
  buildReasoningSurfaceInjection,
  isImplementShipUserMessage,
  resolveReasoningSurface,
  type ReasoningSurface,
} from "./reasoning_surface.js";
// isImplementShipUserMessage is still imported as a fallback for the
// implementShip override below when the classifier wasn't available.
import { scoreTurnAgainstIndex, detectContradictions, type RankableDoc } from "./memory_rank.js";
import { EDIT_TOOL_NAMES, collectEditToolTargetPaths } from "./tool_changed_paths.js";
import { ToolDag } from "./tool_dag.js";
import { SessionToolIndex } from "./session_tool_index.js";
import { ResearchLedger } from "./research_ledger.js";
import {
  extractPreferredNameFromMessage,
  formatIdentityRecallBlock,
  loadIdentityNotesFromDisk,
  shouldPrimeMemoryThisRound,
} from "./user_identity_memory.js";
import { PasteScheduler } from "./paste_scheduler.js";
import { predictNextTools } from "./paste_pattern_store.js";
import { inferSpeculationArgs } from "./paste_args_inference.js";
import { maybeWriteTrajectory } from "./trajectory_writer.js";
import { scoreTurnOutcome, recordEffortOutcome, getBestEffortForIntent } from "./outcome_scorer.js";
import { WorldContextRefresher } from "./world_context_delta.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function buildNeutralChildPersonaMessage(): Message {
  return {
    role: "system",
    content:
      "You are a focused specialist sub-agent. Execute only the assigned subtask. " +
      "Stay within scope, surface uncertainties, and return merge-ready outputs for your parent agent.",
  };
}

function buildSpawnContractPrelude(contract: ChildAgentConfig["spawnContract"]): string {
  if (!contract) return "";
  const lines: string[] = [
    "[SPAWN CONTRACT]",
    `Role: ${contract.role}`,
    `Objective: ${contract.objective}`,
    `Deliverable Format: ${contract.deliverableFormat}`,
  ];
  if (contract.successCriteria.length > 0) {
    lines.push("Success Criteria:");
    for (const item of contract.successCriteria) lines.push(`- ${item}`);
  }
  if (contract.nonGoals?.length) {
    lines.push("Non-goals:");
    for (const item of contract.nonGoals) lines.push(`- ${item}`);
  }
  if (contract.handoffRequirements?.length) {
    lines.push("Handoff Requirements:");
    for (const item of contract.handoffRequirements) lines.push(`- ${item}`);
  }
  return lines.join("\n");
}

/**
 * Wraps an async iterable so that each individual chunk must arrive within
 * `timeoutMs`. Throws STREAM_CHUNK_TIMEOUT if the provider stalls mid-stream.
 * The finally clause calls iter.return() to release the underlying connection.
 */
async function* withChunkTimeout<T>(
  stream: AsyncIterable<T>,
  timeoutMs: number | (() => number)
): AsyncGenerator<T> {
  const iter = stream[Symbol.asyncIterator]();
  const resolveTimeout = () => (typeof timeoutMs === "function" ? timeoutMs() : timeoutMs);
  try {
    while (true) {
      const waitMs = resolveTimeout();
      let timerId: ReturnType<typeof setTimeout> | undefined;
      const chunkPromise = iter.next();
      const timeoutPromise = new Promise<never>((_, reject) => {
        timerId = setTimeout(
          () =>
            reject(
              new Error(
                `STREAM_CHUNK_TIMEOUT: No data received for ${Math.round(waitMs / 1000)}s — ` +
                  "provider may be stalled. For very large files (thousands of lines), consider writing in sections to reduce per-completion size."
              )
            ),
          waitMs
        );
      });
      let result: IteratorResult<T, unknown>;
      try {
        result = await Promise.race([chunkPromise, timeoutPromise]);
      } finally {
        clearTimeout(timerId);
      }
      if (result.done) break;
      yield result.value;
    }
  } finally {
    await iter.return?.();
  }
}

function resolveApprovalTimeoutMs(config: AgentConfig): number {
  if (config.approvalTimeoutMs != null && Number.isFinite(config.approvalTimeoutMs)) {
    return Math.max(10_000, Math.min(600_000, config.approvalTimeoutMs));
  }
  const raw = resolveHarnessEnvRaw("AGENT_APPROVAL_TIMEOUT_MS", config.runtimePreferences ?? null)?.trim();
  if (raw) {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n)) return Math.max(10_000, Math.min(600_000, n));
  }
  return 60_000;
}

function resolveAutoApproveDestructive(config: AgentConfig): boolean {
  if (config.autoApproveDestructive != null) return config.autoApproveDestructive === true;
  return resolveHarnessEnvRaw("AGENT_YOLO", config.runtimePreferences ?? null) === "1";
}

function clampInt(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}

type LintSeverity = "error" | "warning";
type LintMode = "tsc" | "eslint" | "command";

interface LintDiagnostic {
  file: string;
  line: number;
  column: number;
  severity: LintSeverity;
  code: string;
  message: string;
  source: LintMode;
}

interface LintEnvelope {
  mode: LintMode;
  cwd: string;
  diagnostics: LintDiagnostic[];
  summary: {
    total: number;
    errors: number;
    warnings: number;
    files: number;
  };
  raw_excerpt?: string;
}

function parseLintEnvelope(raw: string): LintEnvelope | null {
  try {
    const parsed = JSON.parse(raw) as Partial<LintEnvelope>;
    if (!parsed || typeof parsed !== "object") return null;
    if (!Array.isArray(parsed.diagnostics) || !parsed.summary || typeof parsed.mode !== "string") return null;
    return parsed as LintEnvelope;
  } catch {
    return null;
  }
}

function normalizeFilePathForCompare(p: string): string {
  return p.replace(/\\/g, "/").toLowerCase();
}

function resolveIntentConfidenceThreshold(): number {
  const raw = effectiveHarnessEnvRaw("AGENT_INTENT_CONFIDENCE_MIN")?.trim();
  const n = raw ? Number(raw) : 0.65;
  if (!Number.isFinite(n)) return 0.65;
  return Math.max(0.4, Math.min(0.95, n));
}

function normalizeRuntimePreferencePatch(patch: Partial<RuntimePreferences>): Partial<RuntimePreferences> {
  const out: Partial<RuntimePreferences> = {};
  if (patch.provider) {
    const p: NonNullable<RuntimePreferences["provider"]> = {};
    if (typeof patch.provider.model === "string" && patch.provider.model.trim().length > 0) {
      p.model = patch.provider.model.trim().slice(0, 200);
    }
    if (typeof patch.provider.baseURL === "string" && patch.provider.baseURL.trim().length > 0) {
      p.baseURL = patch.provider.baseURL.trim();
    }
    if (patch.provider.keySource) p.keySource = patch.provider.keySource;
    if (Object.keys(p).length > 0) out.provider = p;
  }
  if (patch.runtime) {
    const r: NonNullable<RuntimePreferences["runtime"]> = {};
    if (patch.runtime.uiVerbosity) r.uiVerbosity = patch.runtime.uiVerbosity;
    if (patch.runtime.vaultAutoWriteMode) r.vaultAutoWriteMode = patch.runtime.vaultAutoWriteMode;
    if (patch.runtime.destructiveGate) r.destructiveGate = patch.runtime.destructiveGate;
    if (patch.runtime.approvalTimeoutMs != null && Number.isFinite(patch.runtime.approvalTimeoutMs)) {
      r.approvalTimeoutMs = clampInt(patch.runtime.approvalTimeoutMs, 10_000, 600_000);
    }
    if (patch.runtime.rateLimitMaxRetries != null && Number.isFinite(patch.runtime.rateLimitMaxRetries)) {
      r.rateLimitMaxRetries = clampInt(patch.runtime.rateLimitMaxRetries, 0, 500);
    }
    if (
      patch.runtime.transient5xxMaxRetries != null &&
      Number.isFinite(patch.runtime.transient5xxMaxRetries)
    ) {
      r.transient5xxMaxRetries = clampInt(patch.runtime.transient5xxMaxRetries, 0, 200);
    }
    if (patch.runtime.retryMaxDelayMs != null && Number.isFinite(patch.runtime.retryMaxDelayMs)) {
      r.retryMaxDelayMs = clampInt(patch.runtime.retryMaxDelayMs, 1_000, 600_000);
    }
    if (Object.keys(r).length > 0) out.runtime = r;
  }
  if (patch.persona) {
    const p: NonNullable<RuntimePreferences["persona"]> = {};
    if (typeof patch.persona.bootstrapCompleted === "boolean") {
      p.bootstrapCompleted = patch.persona.bootstrapCompleted;
    }
    if (typeof patch.persona.sourcePrompt === "string") {
      p.sourcePrompt = patch.persona.sourcePrompt.slice(0, 2000);
    }
    if ("activeProfile" in patch.persona) {
      p.activeProfile = patch.persona.activeProfile ?? null;
    }
    const normalizedControls = normalizePersonaControlsPatch(patch.persona.controls);
    if (normalizedControls) {
      p.controls = normalizedControls;
    }
    if (patch.persona.updatedAt != null && Number.isFinite(patch.persona.updatedAt)) {
      p.updatedAt = Math.max(0, Math.floor(patch.persona.updatedAt));
    }
    if (Object.keys(p).length > 0) out.persona = p;
  }
  if (patch.harness?.env) {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(patch.harness.env)) {
      if (!HARNESS_MANAGED_ENV_KEY_SET.has(k)) continue;
      if (HARNESS_SECRET_ENV_KEYS.has(k)) continue;
      if (typeof v !== "string") continue;
      const t = v.trim().slice(0, 8000);
      if (t.length > 0) env[k] = t;
    }
    if (Object.keys(env).length > 0) out.harness = { env };
  }
  return out;
}

function hasRuntimePreferenceChange(patch: Partial<RuntimePreferences>): boolean {
  return Boolean(
    (patch.provider && Object.keys(patch.provider).length > 0) ||
      (patch.runtime && Object.keys(patch.runtime).length > 0) ||
      (patch.persona && Object.keys(patch.persona).length > 0) ||
      (patch.harness?.env && Object.keys(patch.harness.env).length > 0)
  );
}

function buildToolAwarenessSnapshot(registry: ToolRegistry, recentTools: string[] = []): string {
  const active = registry.getActiveToolNames();
  const total = registry.getToolNames().length;
  const inactive = Math.max(0, total - active.length);
  const fam = registry
    .getActiveFamilySummary(24)
    .map((f) => `${f.family}(${f.active}/${f.total})`)
    .join(", ");
  const tail = active.slice(0, 16).join(", ") || "(none)";
  const recent = [...new Set(recentTools)].slice(-12).join(", ") || "(none)";
  const lazyHint = registry.isLazyToolLoading()
    ? "REMINDER: when capability is missing, call list_tool_families then activate_tool_family for the nearest family."
    : "REMINDER: lazy loading off; all registered tools are available.";
  return (
    `TOOL STATE: lazy=${registry.isLazyToolLoading() ? "on" : "off"}, active_count=${active.length}, inactive_count=${inactive}, registered_total=${total}\n` +
    `ACTIVE FAMILIES: ${fam || "(none)"}\n` +
    `ACTIVE TOOLS (sample): ${tail}\n` +
    `RECENT TOOLS THIS TURN: ${recent}\n` +
    `${lazyHint}`
  );
}

function buildToolCapabilityManifest(registry: ToolRegistry): string {
  const allTools = registry.getToolNames();
  const activeSet = new Set(registry.getActiveToolNames());
  const byFamily = new Map<string, string[]>();
  const unmapped: string[] = [];

  for (const tool of allTools) {
    const fam = registry.getSuggestedFamilyForTool(tool);
    if (!fam) {
      unmapped.push(tool);
      continue;
    }
    const bucket = byFamily.get(fam) ?? [];
    bucket.push(tool);
    byFamily.set(fam, bucket);
  }

  const famLines = [...byFamily.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([fam, tools]) => {
      const sorted = [...tools].sort();
      const active = sorted.filter((t) => activeSet.has(t));
      const inactive = sorted.filter((t) => !activeSet.has(t));
      return (
        `- ${fam}: active=${active.length}/${sorted.length}\n` +
        `  tools: ${sorted.join(", ")}\n` +
        `  inactive_tools: ${inactive.length > 0 ? inactive.join(", ") : "(none)"}`
      );
    });

  if (unmapped.length > 0) {
    famLines.push(
      `- unmapped: active=${unmapped.filter((t) => activeSet.has(t)).length}/${unmapped.length}\n` +
      `  tools: ${unmapped.sort().join(", ")}`
    );
  }

  return (
    `TOOL CAPABILITY MANIFEST\n` +
    `lazy_mode=${registry.isLazyToolLoading() ? "on" : "off"}; ` +
    `registered_total=${allTools.length}; active_total=${activeSet.size}\n` +
    `Families and tools:\n${famLines.join("\n")}\n` +
    `Activation path: call list_tool_families (optionally with task_hint), then activate_tool_family({family}), then retry needed tool.`
  );
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
  const msg = describeError(err).toLowerCase();
  if (/\b429\b|rate.?limit|too many requests|temporarily rate-limited|rate_limit_exceeded/.test(msg)) return true;
  if (/econnreset|socket hang up|etimedout|network|fetch failed|und_err_socket/.test(msg)) return true;
  return false;
}

function isRateLimitError(err: unknown): boolean {
  if (err instanceof OpenAI.RateLimitError) return true;
  if (err instanceof OpenAI.APIError && err.status === 429) return true;
  const msg = describeError(err).toLowerCase();
  return /\b429\b|rate.?limit|too many requests/.test(msg);
}

function isProviderUnavailableError(err: unknown): boolean {
  if (err instanceof OpenAI.APIError && err.status != null && err.status >= 500) return true;
  const msg = describeError(err).toLowerCase();
  return /provider.*unavailable|temporarily unavailable|bad gateway|gateway|upstream|econnreset|socket hang up|etimedout/i.test(msg);
}

function getRetryAfterMsFromError(err: unknown): number | null {
  const asAny = err as { headers?: Record<string, string | string[]>; message?: string } | null;
  const candidates: number[] = [];

  const retryAfter = asAny?.headers?.["retry-after"];
  const raw = Array.isArray(retryAfter) ? retryAfter[0] : retryAfter;
  if (raw) {
    const secs = Number(raw);
    if (Number.isFinite(secs)) candidates.push(Math.max(0, Math.round(secs * 1000)));
    const ts = Date.parse(raw);
    if (Number.isFinite(ts)) candidates.push(Math.max(0, ts - Date.now()));
  }

  const msg = String(asAny?.message ?? describeError(err));
  const m = msg.match(/retry after\s+(\d+)\s*(ms|s|sec|seconds)?/i);
  if (m) {
    const n = parseInt(m[1] ?? "0", 10);
    const unit = (m[2] ?? "s").toLowerCase();
    if (Number.isFinite(n) && n > 0) {
      candidates.push(unit.startsWith("ms") ? n : n * 1000);
    }
  }

  const jsonRetry = msg.match(/"retry_after"\s*:\s*"?(\d+)"?/i);
  if (jsonRetry) {
    const n = parseInt(jsonRetry[1] ?? "0", 10);
    if (Number.isFinite(n) && n > 0) {
      // Heuristic: small values are usually seconds (OpenRouter / providers).
      candidates.push(n < 12_000 ? n * 1000 : n);
    }
  }

  const upstream = suggestedWaitMsFromUpstreamThrottleMessage(msg);
  if (upstream != null) candidates.push(upstream);

  if (candidates.length === 0) return null;
  return Math.max(...candidates.filter((x) => Number.isFinite(x) && x > 0));
}

/** When the body says upstream is throttling but Retry-After is missing, wait longer before retry. */
function suggestedWaitMsFromUpstreamThrottleMessage(msg: string): number | null {
  const t = msg.toLowerCase();
  if (
    !/temporarily rate-limited upstream|rate-limited upstream|upstream.*throttl|please retry shortly/.test(
      t
    )
  ) {
    return null;
  }
  const env = effectiveHarnessEnvRaw("AGENT_UPSTREAM_429_SUGGESTED_WAIT_MS")?.trim();
  if (env) {
    const n = parseInt(env, 10);
    if (Number.isFinite(n) && n > 0) return Math.min(300_000, n);
  }
  return 8000;
}

function isRetryForeverEnabled(): boolean {
  return effectiveHarnessEnvRaw("AGENT_RETRY_FOREVER") === "1";
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

function hasUsefulRecallPayload(
  output: string,
  seed: string,
  minOverlap: number,
  opts?: { identityLike?: boolean }
): boolean {
  const t = output.trim();
  if (!t || /\(no .*matches\)|^\(no matches\)$/im.test(t)) return false;
  // Identity recall: skip Jaccard entirely. "Trai Darlington" has zero word overlap
  // with "do you know my name?" — the name IS the useful payload.
  if (opts?.identityLike) return true;
  if (!seed.trim()) return true;
  const overlap = lexicalJaccard(t.slice(0, 2500), seed.slice(0, 500));
  return overlap >= minOverlap;
}

function normalizeSearchDelta(text: string): string {
  return text
    .replace(/<longcat_tool_call>[\s\S]*?<\/longcat_tool_call>/gi, "")
    .replace(/\uFFFD/g, "")
    .replace(/([A-Za-z])⚙([A-Za-z])/g, "$1$2")
    .replace(/<\/?longcat_[^>]*>/gi, "")
    .replace(/<\s*\/?\s*longcat[^>]*>/gi, "")
    .replace(/\n{3,}/g, "\n\n");
}

function hasPseudoToolMarkup(text: string): boolean {
  const t = text.toLowerCase();
  return (
    t.includes("<longcat_tool_call") ||
    t.includes("<longcat_arg_key") ||
    t.includes("<longcat_arg_value") ||
    t.includes("</longcat_tool_call") ||
    t.includes("<longcat_") ||
    t.includes("</longcat_")
  );
}

/** Harness-injected user turn: model greets on new session (no tools). */
function buildSessionGreetingUserPrompt(persona?: PersonaConfig): string {
  const name = persona?.name?.trim() || "Assistant";
  const voice = persona?.voice?.trim();
  const traits = persona?.traits?.filter(Boolean).join(", ");
  const voiceBit = voice ? ` Voice / surface syntax (follow on the page, not as a label): ${voice}` : "";
  const traitsBit = traits ? ` Tags: ${traits}.` : "";
  return (
    `[SESSION START — harness] The user just opened a new chat session.${voiceBit}${traitsBit} ` +
    `You are "${name}". Write the opening 2–4 short sentences **in full voice**: same sentence mechanics, rhythm, and lexical habits ` +
    `as your system identity — including when describing the session or workspace. ` +
    `Welcome them, signal that context is loaded, invite what to work on. ` +
    `Avoid fixed catchphrase templates and avoid reusing any opener from the previous greeting. ` +
    `Do not call tools. Do not use markdown headings. ` +
    `Skip long capability inventories unless they ask.`
  );
}

/** Harness-injected user turn: model asks for first-run persona preferences. */
function buildPersonaBootstrapUserPrompt(persona?: PersonaConfig): string {
  const name = persona?.name?.trim() || "Assistant";
  return (
    `[SESSION START — persona bootstrap] First run personalization. Ask the user (in 4-6 short lines) ` +
    `how they want ${name} to sound. Include concrete prompts: tone, cadence, confidence, humor, and inspirations ` +
    `(historical/fictional archetypes are allowed). Tell them they can type one paragraph and you will build it. ` +
    `Do not call tools. Keep it warm and concise. No markdown headings.`
  );
}

/**
 * Map a failing tool-name + error-snippet pair to a concrete suggested
 * alternative tool. Heuristic — used inside the loop-break nudge to point the
 * model at the obvious right tool when it's stuck on the wrong one.
 */
function inferLoopBreakSuggestion(toolName: string, errSnippet: string): string | null {
  const err = errSnippet.toLowerCase();
  if (toolName === "read_file") {
    if (err.includes("eisdir") || err.includes("is a directory") || err.includes("directory")) {
      return "the path is a directory — use `list_dir` (to see entries) or `repo_map` (for a structural overview) instead of `read_file`.";
    }
    if (err.includes("enoent") || err.includes("no such file")) {
      return "the file does not exist — use `list_dir` on the parent directory to see what's actually there, or `grep_file` to search for the name.";
    }
  }
  if (toolName === "list_dir") {
    if (err.includes("enotdir") || err.includes("not a directory")) {
      return "the path is a file, not a directory — use `read_file` instead.";
    }
  }
  if (toolName === "write_file") {
    if (err.includes("eisdir") || err.includes("is a directory")) {
      return "the path is a directory — pick an actual file name to write to.";
    }
    if (err.includes("eacces") || err.includes("permission denied")) {
      return "permission denied — check the path is inside the chat's workspace, not outside it.";
    }
  }
  if (toolName === "edit_file") {
    if (err.includes("not found") || err.includes("no match")) {
      return "the old text wasn't found — re-read the file with `read_file` to see its current exact content, then redo the edit with the verbatim string.";
    }
  }
  if (toolName === "web_fetch" && (err.includes("403") || err.includes("401"))) {
    return "the site is blocking the request — try a different URL, search for the topic via `web_search`, or skip this source.";
  }
  return null;
}

type VaultAutoWriteMode = "off" | "research" | "aggressive";

function resolveVaultAutoWriteMode(): VaultAutoWriteMode {
  const raw = (effectiveHarnessEnvRaw("AGENT_VAULT_AUTO_WRITE") ?? "").trim().toLowerCase();
  if (raw === "0" || raw === "off" || raw === "false" || raw === "disabled") return "off";
  if (raw === "aggressive") return "aggressive";
  if (raw === "research") return "research";
  // Default behavior: explicit-only persistence via tool calls.
  return "off";
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
    pattern: /STREAM_CHUNK_TIMEOUT|stream.*stalled|stream.*interrupted/i,
    category: "STREAM_INTERRUPTED",
    hint: "The model's output stream stalled mid-completion — provider stopped sending chunks.",
    template: "For very large file generation, call write_file with mode=create once, then mode=append for each follow-up section. Or use run_shell with a heredoc. Most files are fine in a single write_file call.",
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
    pattern: /bare_ip_without_host|HTTP request failed|fetch failed/i,
    category: "HTTP_PROBE_FAIL",
    hint: "Direct HTTP to bare IP:port or TLS mismatch often fails from Node fetch.",
    template:
      "Use web_fetch on the hostname (not https://IP:port), browser_open for bot walls, or run_shell: curl.exe -k -H \"Host: <hostname>\" https://<ip>:<port>/. Synthesize from evidence already in chat (Shodan/WHOIS/user paste).",
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
    write_file: "mode=create errors if the file exists — use mode=overwrite to replace it, or edit_file for a targeted change. For very large files, write once with mode=create then mode=append for follow-up sections.",
    edit_file: "Targeted change to an existing file: replacements [{search, replace}] or a diff hunk. grep_file first to find the exact text.",
    run_background: "Ensure the command is valid and cwd exists. Check startup_wait_ms.",
    web_fetch: "Verify the URL is correct with web_search first. Check for auth/redirects.",
    http_request:
      "Do not probe https://<IP>:<port>. Use web_fetch on hostnames or run_shell curl with Host header.",
    web_search: "Rephrase the query or use a more specific search term. Empty results are not a hard failure.",
    run_shell:
      "Non-zero exit with long output may still be useful (nslookup/curl -v). Read stderr before retrying.",
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
  "reflect_debate",         // spawns child harnesses — must close over the correct harness
  "check_context",          // closes over parent's ContextManager — child needs its own
  "compress_context",       // same
  "refresh_world_context",  // root-only; children skip world context entirely
  "set_persona",            // closes over parent harness — child inherits parent's persona
  "append_persona_living",  // closes over harness; appends soul/living.md + reload persona block
  "get_runtime_settings",   // closes over harness — reads effective runtime prefs
  "set_runtime_settings",   // closes over harness — patch runtime prefs / persona controls
  "upload_image",           // closes over harness
  "hypothesize",
  "extract_structured",     // closes over harness
  "decompose_goal",         // closes over harness (uses harness.config for LLM access)
  "branch_explore",         // closes over harness.forkChild + harness.orchestrator
  "verify_contract",        // closes over harness.getExecutionState()
  "synthesis_run",          // closes over harness (LLM calls via config)
  "query_tool_outputs",     // closes over harness._sessionToolIndex
  "research_state",         // closes over harness._researchLedger
  "dispatch_graph",         // closes over harness._toolDag
  "branch_evaluate",        // closes over harness.forkChild + harness.orchestrator
]);

// ADAPTIVE_HINTS removed — unified into buildAdaptiveHint() with ERROR_TAXONOMY (#9)

export class AgentHarness {
  readonly emitter: AgentEmitter;
  registry: ToolRegistry;           // non-readonly so forkChild can scope it
  readonly config: AgentConfig;     // exposed for child harness creation
  readonly taskId: string;
  /** Per-harness workspace root. Wraps every send() in an AsyncLocalStorage scope. */
  readonly workspaceRoot: string;
  readonly orchestrator: TaskOrchestrator;
  readonly agentDepth: number;

  private readonly context: ContextManager;
  private readonly dispatcher: ToolDispatcher;
  private client: OpenAI;
  private readonly maxAgentDepth: number;
  private readonly maxConcurrentAgents: number;
  private spawnConcurrencyCap: number;
  private providerDegradedUntilMs = 0;
  private providerCircuitOpenUntilMs = 0;
  private consecutiveProviderFailures = 0;
  /** Human approval TTL for destructive requiresApproval tools (dispatcher). */
  private readonly approvalTimeoutMs: number;
  private running = false;
  private abortSignal?: AbortSignal;
  /** Per-turn abort controller — created at send() start, cleared on turn end. */
  private currentTurnController?: AbortController;
  /** Per-turn trace ID for correlating all events within one send() call. */
  private currentTurnTraceId?: string;
  /**
   * Active hypotheses carried forward from the previous send() so multi-turn
   * investigative chains survive across conversation turns.
   * Only hypotheses with status "active" (or no status) are persisted.
   */
  private persistedHypotheses: import("./types.js").EpistemicState["hypotheses"] = [];

  /** Incremented each ReAct round; accessible for subtask result reporting. */
  roundCount = 0;

  /**
   * Called after forkChild creates a child harness, before running it.
   * Set by external code (orchestration tools) to register child-scoped tools.
   */
  onChildCreated?: (child: AgentHarness) => void;

  /**
   * Optional per-turn cleanup when {@link emitTurnEnd} runs (e.g. Playwright browser sessions).
   * Set by `packages/tools` during `registerAllTools` — must not import tools from core.
   */
  onTurnEndCleanup?: (taskId: string) => void | Promise<void>;

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
  /** Count repeated full read_file calls per path in this send. */
  private readFilePathCountsThisTurn = new Map<string, number>();
  /** One-shot nudge when large read_file output is truncated/distilled. */
  private largeReadPivotNudgeThisSend = false;
  /** Last few tool outcome one-liners for working state. */
  private recentToolOutcomeLines: string[] = [];
  /**
   * Track consecutive (tool_name, args_hash, ok) triples to detect call loops.
   * When the same failing call repeats N times the harness injects a strong
   * corrective system message and adds the (name, hash) to a per-send banlist
   * so subsequent identical calls are short-circuited with a clear "try
   * something else" error instead of dispatching again.
   */
  private toolCallStreak: { name: string; argsHash: string; failures: number } | null = null;
  private bannedToolCallShapesThisSend = new Set<string>();
  private loopBreakNudgeFiredThisSend = false;
  private proactiveCompressedThisSend = false;
  private criticConsumedThisSend = false;
  /** Timestamp of the last compression event in this send (for ACON failure analysis). */
  private lastCompressionTimestampThisSend = 0;
  /** Whether ACON guideline analysis has fired this send (one-shot). */
  private aconGuidelineAnalyzedThisSend = false;
  /** Cached query rewrite for mid-turn recall (AGENT_QUERY_REWRITE). */
  private recallRewriteThisSend: RewriteQueryResult | null = null;
  /** Per-turn routing profile cache — built once per send(), reused across rounds. */
  private _turnRoutingProfile: RoutingProfile | null = null;
  /** Evidence excerpts for evidence-bounded critic (AGENT_CRITIC_EVIDENCE). */
  private evidenceLog: Array<{
    toolCallId: string;
    name: string;
    hash: string;
    excerpt: string;
  }> = [];

  /** At most one turn_end per send() — round cap / timeout / error paths share this. */
  private turnEndEmittedThisSend = false;
  /** One-shot rule recall suffix (named protocol rules) at round 2. */
  private ruleRecallInjectedThisSend = false;
  /** Rule IDs injected by the round-2 rule recall this send (for effectiveness scoring at turn end). */
  private injectedRuleIdsThisSend: string[] = [];
  /** Extra stream continuation when model hits token limit (max 1 per send). */
  private lengthResumeRemaining = 0;
  private writeIntegrityNudgeThisSend = false;
  private fileWriteStreamSink: FileWriteStreamSink | null = null;
  /** Serialize write_file / edit_file on the same path within one send(). */
  private readonly fileWritePathTail = new Map<string, Promise<void>>();
  /** Retry budget when model emits pseudo tool markup instead of actual tool calls. */
  private pseudoToolMarkupRetryRemaining = 1;
  /** Count of suppressed pseudo-markup stream chunks this send (for compact trace). */
  private pseudoMarkupSuppressCountThisSend = 0;
  /** Emit suppression trace at most once per send to avoid spam. */
  private pseudoMarkupSuppressionNotifiedThisSend = false;
  /** web_search query history for first-pass diversity + dedupe checks. */
  private webSearchQueriesThisTurn: string[] = [];
  /** Near-duplicate failed search intents for one-shot retry discipline. */
  private failedSearchIntentCounts = new Map<string, number>();
  /** Per-send research workspace state — populated by web_search / web_fetch results. */
  private readonly _researchLedger = new ResearchLedger();
  /** Last ledger version injected as a [RESEARCH STATE] block this send. */
  private _lastResearchLedgerInjectedVersion = 0;
  /** Successful edit/write targets in this send, used for lint self-heal scoping. */
  private changedFilesThisTurn = new Set<string>();
  /** Related files observed from lint diagnostics in this send. */
  private lintRelatedFilesThisTurn = new Set<string>();
  /** When true, this send() is the opening session greeting (no tools, lighter finalize). */
  private sessionGreetingThisSend = false;
  /** After a successful session greeting, skip duplicate greets until reset(). */
  private sessionGreetingSentThisHarness = false;
  /** When true, this send() asks first-run persona bootstrap questions. */
  private personaBootstrapPromptThisSend = false;
  /** After sending first-run bootstrap prompt once, avoid repeats until reset(). */
  private personaBootstrapPromptSentThisHarness = false;

  /** Active persona. Set via setPersona(); defaults to config.persona or unnamed default. */
  private currentPersona?: PersonaConfig;
  /** Cross-harness shared memory bus (created on root, propagated to children). */
  readonly sharedBus: SharedMemoryBus;
  /** Long-horizon runtime state persisted by task_checkpoint and heartbeat events. */
  private executionState: ExecutionState | null = null;
  /** Intra-round tool dependency DAG (populated by dispatch_graph, cleared after each dispatch). */
  private readonly _toolDag = new ToolDag();
  /** In-session BM25 index of tool outputs (cleared at turn end). */
  private readonly _sessionToolIndex = new SessionToolIndex();
  /** PASTE predictive-speculation scheduler — lazy-init on first use under AGENT_PASTE_PREDICTIVE=1. */
  private _pasteScheduler: PasteScheduler | null = null;
  /** Tool names successfully dispatched this send, in order — feeds the PASTE context window. */
  private _pasteRecentTools: string[] = [];
  /** Tools already speculated this send (toolName::argsKey) — avoid duplicate dispatches. */
  private _pasteSpeculatedKeys = new Set<string>();
  /** Per-turn tool outcome log for trajectory/effort recording. */
  private _toolOutcomesThisTurn: Array<{ name: string; ok: boolean }> = [];
  /** Volatile world context refresher — root agent only, null on child agents. */
  private _worldRefresher: WorldContextRefresher | null = null;
  private vaultMetrics = { reads: 0, searches: 0, writes: 0, skippedWrites: 0 };
  private runtimePreferences: RuntimePreferences | null = null;

  /** True when harness trace / provider retry lines should be hidden. */
  private isUiQuiet(): boolean {
    return resolveHarnessEnvRaw("AGENT_UI_VERBOSITY", this.runtimePreferences) === "quiet";
  }

  private pendingRiskyPreferenceSummary: string | null = null;
  private turnInference: TurnInferenceResult | null = null;
  private _turnReasoningBudget: ReasoningBudget | null = null;
  private _turnReasoningSurface: ReasoningSurface = "external";
  private toolCallsDispatchedThisSend = 0;
  /** When set, blocks side-effecting tools until ask_user resolves clarification. */
  private breakdownClarificationGate: string | null = null;
  private streamingToolNamesByCallId = new Map<string, string>();
  private lastAutoDreamScanAt = 0;
  private autoDreamBackgroundRunning = false;

  /** Idle personality heartbeat (root only; AGENT_HEARTBEAT=1). */
  private personalityHeartbeatIdleTimer: ReturnType<typeof setTimeout> | null = null;
  private personalityHeartbeatRunning = false;
  private lastPersonalityHeartbeatCompletedAt = 0;
  private personalityHeartbeatNudgeTimestampsMs: number[] = [];
  private lastTurnTerminationReason: TurnEndTerminationReason | null = null;

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

  /**
   * @internal — used by packages/tools for cross-agent event emission (e.g. consensus_conflict).
   */
  getEmitter(): AgentEmitter {
    return this.emitter;
  }

  /** Returns the intra-round tool DAG (used by dispatch_graph tool). */
  getToolDag(): ToolDag {
    return this._toolDag;
  }

  /** Returns the in-session tool output index (used by query_tool_outputs tool). */
  getSessionToolIndex(): SessionToolIndex {
    return this._sessionToolIndex;
  }

  /** Per-send research workspace (search queries, URL inventory, fetch outcomes). */
  getResearchLedger(): ResearchLedger {
    return this._researchLedger;
  }

  /**
   * Wait for a set of child task IDs to complete, returning SubtaskResult for each.
   * Used by branch_evaluate to collect parallel evaluator results.
   */
  async waitForChildren(taskIds: string[], timeoutMs: number): Promise<SubtaskResult[]> {
    const deadline = Date.now() + timeoutMs;
    return Promise.all(
      taskIds.map(async (id): Promise<SubtaskResult> => {
        while (Date.now() < deadline) {
          const record = this.orchestrator.get(id);
          if (!record) return { taskId: id, ok: false, output: `Unknown task ID: ${id}`, rounds: 0 };
          if (record.status === "done") return { taskId: id, ok: true, output: record.result ?? "(no output)", rounds: 0 };
          if (record.status === "error") return { taskId: id, ok: false, output: record.result ?? "(error)", rounds: 0 };
          if (record.status === "cancelled") return { taskId: id, ok: false, output: "Task was cancelled", rounds: 0 };
          await sleep(200);
        }
        this.orchestrator.cancel(id);
        return { taskId: id, ok: false, output: `Timed out after ${timeoutMs}ms`, rounds: 0 };
      })
    );
  }

  private getActiveContract(): ExecutionContract | null {
    if (!this.executionState?.activeContractId) return null;
    return this.executionState.contracts.find((c) => c.id === this.executionState!.activeContractId) ?? null;
  }

  private syncExecutionStateToContext(): void {
    if (!this.executionState) {
      this.context.setExecutionStateBlock("");
      return;
    }
    this.context.setExecutionStateBlock(renderExecutionStateBlock(this.executionState));
  }

  private checkContractBudgetExceeded(): string | null {
    const contract = this.getActiveContract();
    if (!contract) return null;
    if (this.toolCallsDispatchedThisSend > contract.maxToolCalls) {
      return `Tool call budget exceeded (${this.toolCallsDispatchedThisSend}/${contract.maxToolCalls}).`;
    }
    const elapsedMin = (Date.now() - this.sendStartTime) / 60_000;
    if (elapsedMin > contract.maxMinutes) {
      return `Wall-clock budget exceeded (${elapsedMin.toFixed(1)}/${contract.maxMinutes} min).`;
    }
    if (this.roundCount > contract.maxSteps) {
      return `Round budget exceeded (${this.roundCount}/${contract.maxSteps}).`;
    }
    return null;
  }

  private async maybePlaybackCompensation(reason: string): Promise<void> {
    if (resolveHarnessEnvRaw("AGENT_COMPENSATION_ENABLED", this.runtimePreferences) === "0") return;
    const planId =
      this.executionState?.activeContractId ?? this.executionState?.mission?.id;
    if (!planId) return;
    const ledger = getCompensationLedger();
    if (ledger.entriesForPlan(planId).length === 0) return;
    const results = await ledger.playback(planId);
    ledger.clear(planId);
    if (results.length === 0) return;
    const report = formatCompensationReport(results);
    this.context.appendMessage({ role: "system", content: report });
    this.emitter.emit("recovery_action", {
      strategy: "replan",
      reason: `compensation_playback: ${reason}`,
      notes: report.slice(0, 200),
    });
  }

  private isLikelyKnowledgeTask(): boolean {
    return this.turnInference?.intent === "knowledge";
  }

  private rememberChangedPathFromToolCall(toolName: string, argsJson: string, ok: boolean): void {
    if (!ok) return;
    if (!EDIT_TOOL_NAMES.has(toolName)) return;
    try {
      const args = JSON.parse(argsJson) as Record<string, unknown>;
      for (const c of collectEditToolTargetPaths(toolName, args)) this.changedFilesThisTurn.add(c);
    } catch {
      /* ignore malformed args json */
    }
  }

  private resolveSelfHealMode(): LintMode {
    const raw = (resolveHarnessEnvRaw("AGENT_SELF_HEAL_LINT_MODE", this.runtimePreferences) ?? "tsc").toLowerCase();
    if (raw === "eslint" || raw === "command") return raw;
    return "tsc";
  }

  private resolveSelfHealChangedFirstScope(): string[] {
    const files = [...this.changedFilesThisTurn];
    // Only lint after real edit-tool targets this turn. Omitting "." avoids a
    // full-repo `tsc` on read-only rounds (can hang minutes on wrong workspace roots).
    return files.slice(0, 40);
  }

  private resolveSelfHealExpandedScope(changedScope: string[], diag: LintEnvelope): string[] {
    const changed = new Set(changedScope.map(normalizeFilePathForCompare));
    const all = new Set(changedScope);
    for (const d of diag.diagnostics) {
      if (typeof d.file === "string" && d.file.trim().length > 0) {
        all.add(d.file.trim());
        this.lintRelatedFilesThisTurn.add(d.file.trim());
      }
    }
    for (const f of this.lintRelatedFilesThisTurn) all.add(f);
    const ranked = [...all].sort((a, b) => {
      const aChanged = changed.has(normalizeFilePathForCompare(a));
      const bChanged = changed.has(normalizeFilePathForCompare(b));
      if (aChanged !== bChanged) return aChanged ? -1 : 1;
      return a.localeCompare(b);
    });
    return ranked.slice(0, 80);
  }

  private sortDiagnosticsForRepair(diag: LintEnvelope): LintDiagnostic[] {
    return [...diag.diagnostics].sort((a, b) => {
      const aSyntax = /parse|syntax|unexpected|token|ts1\d{3}/i.test(`${a.code} ${a.message}`);
      const bSyntax = /parse|syntax|unexpected|token|ts1\d{3}/i.test(`${b.code} ${b.message}`);
      if (aSyntax !== bSyntax) return aSyntax ? -1 : 1;
      if (a.severity !== b.severity) return a.severity === "error" ? -1 : 1;
      return `${a.file}:${a.line}:${a.column}`.localeCompare(`${b.file}:${b.line}:${b.column}`);
    });
  }

  private async runLintSelfHealIfNeeded(): Promise<void> {
    if (resolveHarnessEnvRaw("AGENT_SELF_HEAL_LINT", this.runtimePreferences) !== "1") return;
    if (this.agentDepth > 0) return;
    if (!this.registry.has("run_lint")) return;
    const changedFirstScope = this.resolveSelfHealChangedFirstScope();
    if (changedFirstScope.length === 0) return;
    const maxPasses = Math.max(
      1,
      Math.min(8, parseInt(resolveHarnessEnvRaw("AGENT_SELF_HEAL_MAX_PASSES", this.runtimePreferences) ?? "4", 10) || 4)
    );
    const stopOnNoProgress = resolveHarnessEnvRaw("AGENT_SELF_HEAL_STOP_ON_NO_PROGRESS", this.runtimePreferences) !== "0";
    const repoWide = resolveHarnessEnvRaw("AGENT_SELF_HEAL_REPO_WIDE", this.runtimePreferences) === "1";
    const mode = this.resolveSelfHealMode();
    const cwd = ".";
    let scope = [...changedFirstScope];
    let previousErrors = Number.POSITIVE_INFINITY;
    let noProgress = 0;
    let lastDiagCount = 0;

    for (let pass = 1; pass <= maxPasses; pass++) {
      const lintArgs: Record<string, unknown> = { cwd, mode, format: "structured" };
      if (mode === "eslint") lintArgs["eslint_paths"] = scope;
      const lintRes = await this.dispatcher.directCall("run_lint", lintArgs);
      const body = lintRes.ok ? lintRes.output : lintRes.error;
      const parsed = parseLintEnvelope(body);
      if (!parsed) {
        this.emitter.emit("lint_heal_result", {
          status: "escalated",
          passes: pass,
          remainingDiagnostics: 0,
          reason: "run_lint did not return structured diagnostics",
        });
        return;
      }
      const sorted = this.sortDiagnosticsForRepair(parsed);
      const summary = parsed.summary;
      lastDiagCount = summary.total;
      this.emitter.emit("lint_heal_pass", {
        pass,
        maxPasses,
        scope: scope.slice(0, 20),
        mode,
        diagnosticsTotal: summary.total,
        errors: summary.errors,
        warnings: summary.warnings,
        changedFirst: pass === 1,
      });
      if (summary.errors === 0) {
        this.emitter.emit("lint_heal_result", {
          status: "success",
          passes: pass,
          remainingDiagnostics: summary.total,
          reason: "no error-severity diagnostics remain",
        });
        return;
      }
      if (summary.errors >= previousErrors) noProgress++;
      else noProgress = 0;
      previousErrors = summary.errors;
      if (stopOnNoProgress && noProgress >= 2) {
        this.context.appendMessage({
          role: "user",
          content:
            "[SELF-HEAL ESCALATION] Lint diagnostics are not improving after repeated passes. " +
            "Summarize blockers with exact file:line references and propose a safer fix plan.",
        });
        this.emitter.emit("lint_heal_result", {
          status: "escalated",
          passes: pass,
          remainingDiagnostics: summary.total,
          reason: "no progress across two passes",
        });
        return;
      }
      const top = sorted.slice(0, 24);
      const lines = top
        .map((d) => `${d.file}:${d.line}:${d.column} [${d.severity}] ${d.code} ${d.message}`)
        .join("\n");
      this.context.appendMessage({
        role: "user",
        content:
          "[SELF-HEAL LINT PASS] Fix the following diagnostics now using minimal targeted edits. " +
          "Prioritize syntax/parser/type errors before style warnings.\n" +
          `Pass ${pass}/${maxPasses}, scope: ${scope.join(", ")}\n` +
          lines,
      });
      if (pass === 1) {
        scope = this.resolveSelfHealExpandedScope(changedFirstScope, parsed);
      } else if (repoWide && pass >= 2) {
        scope = ["."];
      }
    }
    this.context.appendMessage({
      role: "user",
      content:
        "[SELF-HEAL ESCALATION] Lint self-heal pass budget exhausted. " +
        "Provide unresolved diagnostics with file:line and ask for user direction if risky refactor is required.",
    });
    this.emitter.emit("lint_heal_result", {
      status: "escalated",
      passes: maxPasses,
      remainingDiagnostics: lastDiagCount,
      reason: "pass budget exhausted",
    });
  }

  private checkContractAndCommitments(
    toolName: string,
    args: Record<string, unknown>
  ): { ok: true } | { ok: false; reason: string; severity: "low" | "med" | "high" } {
    if (this.breakdownClarificationGate && EDIT_TOOL_NAMES.has(toolName)) {
      return {
        ok: false,
        reason:
          `Clarification required before mutating tools. Call ask_user first: ${this.breakdownClarificationGate}`,
        severity: "high",
      };
    }
    if (this.breakdownClarificationGate && (toolName === "run_shell" || toolName === "git_commit")) {
      return {
        ok: false,
        reason:
          `Clarification required before side-effecting tools. Call ask_user first: ${this.breakdownClarificationGate}`,
        severity: "high",
      };
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
        // No diversity / budget refusal here — the ResearchLedger surfaces
        // duplication and inventory directly into the model's context via the
        // [RESEARCH STATE] block + research_state tool, so the model can see
        // overlap and self-regulate. Trust the model; don't block its breadth.
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

  private refreshToolAwareness(reason?: string): void {
    if (this.config.workingStateEnabled === false || !this.context.getEpistemicState()) return;
    const suffix = reason ? `\nAWARENESS_REFRESH_REASON: ${reason}` : "";
    this.context.patchEpistemicState({
      harnessNotes: buildToolAwarenessSnapshot(this.registry, this.toolsUsedThisTurn) + suffix,
    });
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

  /** Returns the latest runtime preferences snapshot (if any). */
  getRuntimePreferences(): RuntimePreferences | null {
    return this.runtimePreferences ? JSON.parse(JSON.stringify(this.runtimePreferences)) : null;
  }

  /**
   * Apply a runtime preference patch and optionally persist it.
   * Used by harness-scoped tools and UI bootstrap flows.
   */
  async patchRuntimePreferences(
    patch: Partial<RuntimePreferences>,
    options?: { persist?: boolean }
  ): Promise<{ persisted: boolean; path?: string }> {
    const normalized = normalizeRuntimePreferencePatch(patch);
    this.applyRuntimePreferencePatch(normalized);
    const shouldPersist = options?.persist !== false;
    if (!shouldPersist || !this.config.persistRuntimePreferences || !this.runtimePreferences) {
      return { persisted: false };
    }
    const out = await this.config.persistRuntimePreferences(this.runtimePreferences);
    return {
      persisted: true,
      ...(typeof out === "string" && out.length > 0 ? { path: out } : {}),
    };
  }

  private rebuildClient(): void {
    this.client = new OpenAI({
      apiKey: this.config.openRouterApiKey,
      baseURL: this.config.baseURL,
      maxRetries: 0,
      defaultHeaders: buildOpenRouterAttributionHeaders(),
    });
  }

  private askUserDirect(prompt: string): Promise<string> {
    return new Promise<string>((resolve) => {
      this.emitter.emit("ask_user", { prompt, resolve });
    });
  }

  private maybeInjectRuntimePreferenceRouting(userMessage: string): void {
    if (this.agentDepth > 0) return;
    const inf = this.turnInference;
    if (!inf?.runtimePreferenceIntent && !inf?.runtimeSettingsQuery) return;
    if (inf.runtimeSettingsQuery) {
      this.context.appendMessage({
        role: "system",
        content:
          "[RUNTIME ROUTING] The user asked to check current runtime/persona settings. " +
          "Call get_runtime_settings (fields: persona_controls for dial checks) before stating values.",
      });
    }
    if (!inf.runtimePreferenceIntent) return;
    const lower = userMessage.toLowerCase();
    const personaDialIntent =
      /\b(humou?r|formality|confidence|verbosity|persona\s*strength|tone|style)\b/.test(lower);
    const routing =
      personaDialIntent
        ? "[RUNTIME ROUTING] The user requested persona control changes. Apply via set_runtime_settings(persona_controls). Do not use remember for this."
        : "[RUNTIME ROUTING] The user requested runtime preference changes. Apply via explicit runtime tools and report tool-backed outcomes only.";
    this.context.appendMessage({ role: "system", content: routing });
  }

  private maybeInjectRuntimeSettingsSnapshot(): void {
    if (this.agentDepth > 0) return;
    const controls = this.runtimePreferences?.persona?.controls;
    if (!controls) return;
    this.context.appendMessage({
      role: "system",
      content:
        "[RUNTIME SETTINGS SNAPSHOT]\n" +
        `humorPercent=${controls.humorPercent ?? "n/a"}, ` +
        `formality=${controls.formality ?? "n/a"}, ` +
        `confidence=${controls.confidence ?? "n/a"}, ` +
        `verbosity=${controls.verbosity ?? "n/a"}, ` +
        `personaStrength=${controls.personaStrength ?? "n/a"}\n` +
        "If these conflict with persona catchphrases or style examples, treat this snapshot as source of truth.",
    });
  }

  private applyRuntimePreferencePatch(patch: Partial<RuntimePreferences>): void {
    const merged: RuntimePreferences = {
      ...(this.runtimePreferences ?? { updatedAt: Date.now() }),
      ...patch,
      version: 1,
      provider: {
        ...(this.runtimePreferences?.provider ?? {}),
        ...(patch.provider ?? {}),
      },
      runtime: {
        ...(this.runtimePreferences?.runtime ?? {}),
        ...(patch.runtime ?? {}),
      },
      persona: {
        ...(this.runtimePreferences?.persona ?? {}),
        ...(patch.persona ?? {}),
        controls: {
          ...(this.runtimePreferences?.persona?.controls ?? {}),
          ...(patch.persona?.controls ?? {}),
        },
      },
      harness: {
        env: {
          ...(this.runtimePreferences?.harness?.env ?? {}),
          ...(patch.harness?.env ?? {}),
        },
      },
      updatedAt: Date.now(),
    };
    this.runtimePreferences = merged;
    this.config.runtimePreferences = merged;

    if (merged.provider?.model) {
      this.config.model = merged.provider.model;
    }
    if (merged.provider?.baseURL) {
      this.config.baseURL = merged.provider.baseURL;
    }
    if (merged.provider?.keySource || merged.provider?.baseURL || merged.provider?.model) {
      const provider = resolveProviderConfig({
        keySource: merged.provider?.keySource,
        baseURL: this.config.baseURL,
        model: this.config.model,
      });
      this.config.openRouterApiKey = provider.apiKey;
      this.config.baseURL = provider.baseURL;
      this.config.model = provider.model;
      this.rebuildClient();
      this.emitter.emit("text", {
        delta:
          `\n[Runtime] Effective provider updated: model=${this.config.model}, ` +
          `baseURL=${this.config.baseURL}\n`,
        channel: "trace",
      });
    }
    if (merged.persona?.activeProfile && merged.persona?.controls) {
      const nextProfile = applyPersonaControlsToProfile(
        merged.persona.activeProfile,
        merged.persona.controls
      );
      merged.persona.activeProfile = nextProfile;
      this.runtimePreferences = merged;
      this.config.runtimePreferences = merged;
      const block = buildRuntimePersonaBlock(nextProfile, merged.persona.controls);
      this.setPersona(personaConfigFromRuntimeProfile(nextProfile), block);
    }
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
  private get retryMaxDelayMs() {
    const raw = resolveHarnessEnvRaw("AGENT_RETRY_MAX_DELAY_MS", this.runtimePreferences)?.trim();
    if (raw) {
      const n = parseInt(raw, 10);
      if (Number.isFinite(n)) return Math.max(1_000, Math.min(600_000, n));
    }
    // Default cap tuned so exponential retries can reach ~4 minutes.
    return 240_000;
  }
  private get rateLimitMaxRetries() {
    const cfg = this.config.maxRateLimitRetries;
    if (typeof cfg === "number" && Number.isFinite(cfg)) return Math.max(0, cfg);
    const raw = resolveHarnessEnvRaw("AGENT_RATE_LIMIT_MAX_RETRIES", this.runtimePreferences)?.trim();
    if (raw) {
      const n = parseInt(raw, 10);
      if (Number.isFinite(n)) return Math.max(0, n);
    }
    // 120 retries with capped exponential backoff handles prolonged provider throttling.
    return 120;
  }
  private get transient5xxMaxRetries() {
    const cfg = this.config.maxTransient5xxRetries;
    if (typeof cfg === "number" && Number.isFinite(cfg)) return Math.max(0, cfg);
    const raw = resolveHarnessEnvRaw("AGENT_TRANSIENT_5XX_MAX_RETRIES", this.runtimePreferences)?.trim();
    if (raw) {
      const n = parseInt(raw, 10);
      if (Number.isFinite(n)) return Math.max(0, n);
    }
    return 60;
  }
  private computeRetryDelayMs(
    attempt: number,
    mode: "normal" | "rate_limited" | "provider_unavailable",
    retryAfterMs?: number | null
  ): number {
    if (typeof retryAfterMs === "number" && Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
      return Math.max(250, Math.min(this.retryMaxDelayMs, retryAfterMs));
    }
    const boosted = mode === "rate_limited" || mode === "provider_unavailable";
    // Boosted paths (429/5xx) target ~4 minutes by around retry 7.
    const base = boosted ? Math.max(4_000, this.retryDelayMs) : this.retryDelayMs;
    const exp = Math.min(attempt, 10);
    const raw = Math.min(this.retryMaxDelayMs, Math.round(base * Math.pow(2, exp)));
    const jitter = Math.round(raw * 0.2 * (Math.random() * 2 - 1));
    return Math.max(250, raw + jitter);
  }
  private get retryWallTimeMs() {
    const raw = resolveHarnessEnvRaw("AGENT_RETRY_WALL_TIME_MS", this.runtimePreferences)?.trim();
    if (raw) {
      const n = parseInt(raw, 10);
      if (Number.isFinite(n)) return Math.max(10_000, Math.min(900_000, n));
    }
    return 120_000;
  }
  private get providerCircuitFailureThreshold() {
    const raw = resolveHarnessEnvRaw("AGENT_PROVIDER_CIRCUIT_FAILURES", this.runtimePreferences)?.trim();
    if (raw) {
      const n = parseInt(raw, 10);
      if (Number.isFinite(n)) return Math.max(2, Math.min(20, n));
    }
    return 4;
  }
  private get providerCircuitCooldownMs() {
    const raw = resolveHarnessEnvRaw("AGENT_PROVIDER_CIRCUIT_COOLDOWN_MS", this.runtimePreferences)?.trim();
    if (raw) {
      const n = parseInt(raw, 10);
      if (Number.isFinite(n)) return Math.max(5_000, Math.min(300_000, n));
    }
    return 45_000;
  }

  constructor(config: AgentConfig) {
    this.config = config;
    this.workspaceRoot = config.workspaceRoot
      ? config.workspaceRoot
      : resolveWorkspaceRoot();
    this.runtimePreferences = config.runtimePreferences ?? null;
    this.config.vision = {
      model:
        config.vision?.model ??
        resolveHarnessEnvRaw("AGENT_VISION_MODEL", this.runtimePreferences)?.trim(),
      baseURL:
        config.vision?.baseURL ??
        resolveHarnessEnvRaw("AGENT_VISION_BASE_URL", this.runtimePreferences)?.trim(),
      apiKey:
        config.vision?.apiKey ??
        resolveHarnessEnvRaw("AGENT_VISION_API_KEY", this.runtimePreferences)?.trim(),
      timeoutMs:
        config.vision?.timeoutMs ??
        (parseInt(
          resolveHarnessEnvRaw("AGENT_VISION_TIMEOUT_MS", this.runtimePreferences) ?? "15000",
          10
        ) || 15_000),
      maxImageBytes:
        config.vision?.maxImageBytes ??
        (parseInt(
          resolveHarnessEnvRaw("AGENT_VISION_MAX_IMAGE_BYTES", this.runtimePreferences) ??
            String(4 * 1024 * 1024),
          10
        ) || 4 * 1024 * 1024),
    };
    if (this.runtimePreferences?.provider?.model) this.config.model = this.runtimePreferences.provider.model;
    if (this.runtimePreferences?.provider?.baseURL) this.config.baseURL = this.runtimePreferences.provider.baseURL;
    this.taskId = config.taskId ?? crypto.randomUUID();
    this.agentDepth = config.agentDepth ?? 0;
    this.maxAgentDepth = config.maxAgentDepth ?? 3;
    this.maxConcurrentAgents = config.maxConcurrentAgents ?? 8;
    this.spawnConcurrencyCap = this.maxConcurrentAgents;
    this.approvalTimeoutMs = resolveApprovalTimeoutMs(config);

    this.emitter = new AgentEmitter();
    this.registry = new ToolRegistry();
    // Shared memory bus: use provided one (child harness) or create a fresh root bus.
    this.sharedBus = config.sharedBus ?? new SharedMemoryBus();
    // Wire onCompressed callback so context compression fires a structured event (#7)
    // Wire semanticSummarizer when AGENT_COMPRESS_SEMANTIC=1 (uses fast model for causal narratives).
    const semanticSummarizer =
      resolveHarnessEnvRaw("AGENT_COMPRESS_SEMANTIC", this.runtimePreferences) === "1" && config.agentDepth === 0
        ? async (rawSummaries: string): Promise<string> => {
            const jr = await completeChatJson(this.client, {
              model: getFastModelSlug(config.model),
              temperature: 0.1,
              maxTokens: 300,
              messages: [
                {
                  role: "system",
                  content:
                    "Summarize these tool-round one-liners as 2-3 concise causal sentences " +
                    "explaining WHAT was investigated, WHY, and WHAT was found. " +
                    "Never drop explicit user numbers, paths, filenames, deadlines, or must-not constraints that appear in the one-liners. " +
                    'Return JSON: {"summary":"<causal narrative>"}. No bullet points.',
                },
                { role: "user", content: rawSummaries.slice(0, 3000) },
              ],
            });
            if (jr.ok && typeof jr.parsed === "object" && jr.parsed !== null) {
              const p = jr.parsed as { summary?: string };
              if (p.summary && p.summary.trim().length > 20) return p.summary.trim();
            }
            return rawSummaries;
          }
        : undefined;
    this.context = new ContextManager({
      ...config.context,
      semanticSummarizer,
      onCompressed: (before, after, rounds) => {
        this.lastCompressionTimestampThisSend = Date.now();
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
      defaultHeaders: buildOpenRouterAttributionHeaders(),
    });
    if (this.runtimePreferences?.provider?.keySource) {
      const provider = resolveProviderConfig({
        keySource: this.runtimePreferences.provider.keySource,
        baseURL: this.config.baseURL,
        model: this.config.model,
      });
      this.config.openRouterApiKey = provider.apiKey;
      this.config.baseURL = provider.baseURL;
      this.config.model = provider.model;
      this.rebuildClient();
    }

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
      resolveAutoApproveDestructive(config),
      (toolName, args) => this.checkContractAndCommitments(toolName, args),
      config.dryRunApprovals === true,
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

  async send(
    userMessage: string,
    options?: { freshContext?: boolean; sessionGreeting?: boolean; personaBootstrapPrompt?: boolean }
  ): Promise<void> {
    // Wrap the entire send in an AsyncLocalStorage scope so every file tool,
    // background persist, and post-turn write resolves this harness's
    // workspace root (instead of the process-global). Lets parallel sub-agents
    // operate on isolated trees (e.g. git worktrees). We also bind the chat id
    // so memory recall + writes can attribute provenance without each tool
    // factory needing a harness reference (federation Phase 2).
    return runWithWorkspaceRoot(this.workspaceRoot, () =>
      runWithChatId(this.taskId, () => this._sendBody(userMessage, options))
    );
  }

  private async _sendBody(
    userMessage: string,
    options?: { freshContext?: boolean; sessionGreeting?: boolean; personaBootstrapPrompt?: boolean }
  ): Promise<void> {
    if (this.running) throw new Error("Agent is already processing a message");
    if (options?.freshContext === true && this.agentDepth === 0) {
      this.reset();
    }
    const sessionGreeting = Boolean(options?.sessionGreeting);
    const personaBootstrapPrompt = Boolean(options?.personaBootstrapPrompt);
    if (sessionGreeting && (this.sessionGreetingSentThisHarness || this.agentDepth !== 0)) {
      return;
    }
    if (personaBootstrapPrompt && (this.personaBootstrapPromptSentThisHarness || this.agentDepth !== 0)) {
      return;
    }
    this.sessionGreetingThisSend = sessionGreeting;
    this.personaBootstrapPromptThisSend = personaBootstrapPrompt;
    this.currentTurnController = new AbortController();
    this.currentTurnTraceId = crypto.randomUUID();
    this.dispatcher.setTurnTraceId(this.currentTurnTraceId);
    this.running = true;
    this.clearPersonalityHeartbeatSchedule();
    this.lastTurnTerminationReason = null;

    return await runHarnessEffectiveEnvContext(this.runtimePreferences, async () => {
    const telemetryUserLabel = sessionGreeting
      ? "(session greeting)"
      : personaBootstrapPrompt
      ? "(persona bootstrap prompt)"
      : userMessage;
    const conversationUserContent = sessionGreeting
      ? buildSessionGreetingUserPrompt(this.getCurrentPersona())
      : personaBootstrapPrompt
      ? buildPersonaBootstrapUserPrompt(this.getCurrentPersona())
      : userMessage;
    const openingTurn = sessionGreeting || personaBootstrapPrompt;

    // Reset per-turn tracking state
    this.toolErrorCounts = new Map();
    this.toolsUsedThisTurn = [];
    this.lastUserMessage = telemetryUserLabel;
    this.contextAlertFired60 = false;
    this.contextAlertFired85 = false;
    this.lastParallelToolBatchSize = 0;
    this.sendStartTime = Date.now();
    this.filesReadThisTurn = [];
    this.readFilePathCountsThisTurn = new Map();
    this.largeReadPivotNudgeThisSend = false;
    this.recentToolOutcomeLines = [];
    this.toolCallStreak = null;
    this.bannedToolCallShapesThisSend.clear();
    this.loopBreakNudgeFiredThisSend = false;
    this.proactiveCompressedThisSend = false;
    this.criticConsumedThisSend = false;
    this.lastCompressionTimestampThisSend = 0;
    this.aconGuidelineAnalyzedThisSend = false;
    this.recallRewriteThisSend = null;
    this._turnRoutingProfile = null;
    this._turnReasoningBudget = null;
    this._turnReasoningSurface = "external";
    this.toolCallsDispatchedThisSend = 0;
    this.breakdownClarificationGate = null;
    this.streamingToolNamesByCallId.clear();
    this.evidenceLog = [];
    this.turnEndEmittedThisSend = false;
    this.ruleRecallInjectedThisSend = false;
    this.injectedRuleIdsThisSend = [];
    this.writeIntegrityNudgeThisSend = false;
    this.fileWritePathTail.clear();
    this.fileWriteStreamSink = new FileWriteStreamSink(
      resolveWriteStreamSinkEnabled(this.runtimePreferences),
      resolveWriteStreamSinkMinChars(this.runtimePreferences),
      this.taskId
    );
    this.dispatcher.setFileWriteHooks({
      prepareArgs: async (callId, name, args) => {
        const sink = this.fileWriteStreamSink;
        if (!sink || !isFileWriteToolName(name)) return args;
        await sink.finalize(callId);
        const taken = sink.takeForDispatch(callId);
        if (!taken) return args;
        setFileWriteStreamManifest({
          callId,
          stagingPath: taken.stagingPath,
          targetPath: taken.targetPath,
          mode: taken.mode,
          bytesWritten: taken.bytesWritten,
        });
        return { ...args, __harness_call_id: callId };
      },
      onRejected: (callId, name) => {
        if (isFileWriteToolName(name)) {
          this.fileWriteStreamSink?.discard(callId);
          discardFileWriteStreamManifest(callId);
        }
      },
    });
    const lengthResumeRaw =
      parseInt(resolveHarnessEnvRaw("AGENT_LENGTH_RESUME_MAX", this.runtimePreferences) ?? "3", 10) || 0;
    this.lengthResumeRemaining = Math.max(0, Math.min(8, lengthResumeRaw));
    this.pseudoToolMarkupRetryRemaining = Math.max(
      0,
      Math.min(3, parseInt(resolveHarnessEnvRaw("AGENT_PSEUDO_TOOL_RETRY_MAX", this.runtimePreferences) ?? "2", 10) || 2)
    );
    this.pseudoMarkupSuppressCountThisSend = 0;
    this.pseudoMarkupSuppressionNotifiedThisSend = false;
    this.dispatcher.resetTurnCounters();
    this._toolDag.clear();
    this._sessionToolIndex.clear();
    if (this._pasteScheduler) this._pasteScheduler.reset();
    this._pasteRecentTools = [];
    this._pasteSpeculatedKeys.clear();
    this._toolOutcomesThisTurn = [];
    this.vaultMetrics = { reads: 0, searches: 0, writes: 0, skippedWrites: 0 };
    this.webSearchQueriesThisTurn = [];
    this.failedSearchIntentCounts = new Map();
    this._researchLedger.clear();
    this._lastResearchLedgerInjectedVersion = 0;
    this.changedFilesThisTurn = new Set();
    this.lintRelatedFilesThisTurn = new Set();
    this.turnInference = null;
    try {
      if (openingTurn) {
        this.turnInference = {
          intent: "introspection",
          complexity: "trivial",
          likelyEditPaths: [],
          stancePrompt: false,
          overInferenceRisk: false,
          exploratoryCreative: false,
          identityQuery: false,
          identityProvision: false,
          personaIdentityPrompt: false,
          runtimeIdentityPrompt: false,
          deckIntent: false,
          freshnessSensitive: false,
          visionIntent: false,
          buildDeliverable: false,
          implementShip: false,
          runtimePreferenceIntent: false,
          runtimeSettingsQuery: false,
          skipHarnessSecondaryPasses: true,
          confidence: 1,
          source: "default",
          reason: "session_greeting",
        };
      } else {
        const prevEpistemic = this.context.getEpistemicState();
        const intentWorkspace: IntentInferenceWorkspaceContext = {
          epistemicFilesModified:
            prevEpistemic?.filesModified && prevEpistemic.filesModified.length > 0
              ? [...prevEpistemic.filesModified]
              : undefined,
          epistemicFilesTouched:
            prevEpistemic?.filesTouched && prevEpistemic.filesTouched.length > 0
              ? [...prevEpistemic.filesTouched]
              : undefined,
          lastAssistantSnippet: (() => {
            const s = (this.context.getLastAssistantMessage() ?? "").trim();
            return s.length > 0 ? s.slice(0, 1200) : undefined;
          })(),
        };
        if (effectiveHarnessEnvRaw("AGENT_INTENT_REPO_CONTEXT") === "1") {
          try {
            intentWorkspace.repoMapLines = await gatherRepoMapLines();
          } catch {
            /* optional orientation */
          }
        }
        this.turnInference = await inferTurnInference(
          this.client,
          this.config.model,
          userMessage,
          intentWorkspace
        );
      }
    } catch {
      this.turnInference = applyTurnInferenceHeuristics(
        userMessage,
        neutralTurnInferenceResult("inference_exception_fallback", {
          fallbackReason: "inferTurnInference threw",
        })
      );
    }
    // Wire the resolved intent into the context so refreshProtocolDynamic can
    // suppress irrelevant protocol sections (saves 300–800 tokens per turn).
    this.context.setProtocolIntentHint(this.turnInference?.intent ?? "any");
    if (!openingTurn) {
      this.context.appendMessage({
        role: "system",
        content:
          "[NO-REINTRO] This is an ongoing session. Do not emit session-initialization/greeting text " +
          "(e.g., 'Session initialized', 'Context loaded', 'What are we working on?') unless the user explicitly asks for a re-introduction.",
      });
    }
    if (
      !openingTurn &&
      this.turnInference &&
      (this.turnInference.source === "llm"
        ? this.turnInference.implementShip === true
        : isImplementShipUserMessage(userMessage)) &&
      (this.turnInference.intent === "knowledge" || this.turnInference.intent === "research")
    ) {
      this.turnInference = {
        ...this.turnInference,
        intent: "coding",
        reason: `${this.turnInference.reason ?? ""} intent_override=coding_implement_trap`.trim(),
      };
    }
    if (this.turnInference && !openingTurn) {
      this.turnInference = applyTurnInferenceHeuristics(userMessage, this.turnInference);
    }
    this._turnRoutingProfile = buildRoutingProfile(this.turnInference ?? null, this.config.model);
    if (!openingTurn) {
      const routingModel = this._turnRoutingProfile.modelSlug;
      const surfaceRes = resolveReasoningSurface(routingModel);
      this._turnReasoningSurface = surfaceRes.surface;
      // Adaptive reasoning effort: seed the fallback prior with the statistically
      // best effort recorded for this intent class (AGENT_EFFORT_LEARN).
      const learnedEffort = this.turnInference
        ? await getBestEffortForIntent(this.turnInference.intent as ReasoningIntentClass)
        : null;
      // When the classifier ran and was confident, hand its typed signals to the
      // budget tightener instead of letting it re-derive them via regex — this
      // catches paraphrases ("spin up a clone", "what's the latest on X") that
      // keyword matching misses.
      const llmSignals =
        this.turnInference?.source === "llm"
          ? {
              implementShip: this.turnInference.implementShip === true,
              buildDeliverable: this.turnInference.buildDeliverable === true,
              freshnessSensitive: this.turnInference.freshnessSensitive === true,
              essayRisk: this.turnInference.essayRisk === true,
            }
          : undefined;
      let budget = tightenReasoningBudgetForUserMessage(
        resolveReasoningBudget(this.turnInference, learnedEffort),
        userMessage,
        llmSignals
      );
      budget = applySurfaceToBudget(budget, this._turnReasoningSurface);
      this._turnReasoningBudget = budget;
      this.context.appendMessage({
        role: "system",
        content: buildReasoningSurfaceInjection(surfaceRes, routingModel),
      });
      this.context.appendMessage({
        role: "system",
        content: buildReasoningBudgetInjection(this._turnReasoningBudget, this._turnReasoningSurface),
      });
    }
    if (!openingTurn && this.turnInference?.exploratoryCreative) {
      this.context.appendMessage({
        role: "system",
        content:
          "[EXPLORATORY TURN] The user message is treated as open-ended, hypothetical, or creative ideation. " +
          "Answer the literal question with novel options, mechanisms, and tradeoffs (general knowledge + deliberate tool use only when it serves this ask). " +
          "Do not let standing project artifacts (roadmaps, cashflow models, quit-job timelines, vault briefs) hijack the response arc unless they explicitly tied this turn to that work. " +
          "At most one brief acknowledgment of relevant background — then pivot to fresh synthesis. Mid-turn memory auto-prime may be off or tightened; open stored plans only if the user asked or you state why they are necessary.",
      });
    }
    if (
      !openingTurn &&
      this.turnInference &&
      (this.turnInference.intent === "research" ||
        (this.turnInference.freshnessSensitive === true && this.turnInference.toolFirstBias === true))
    ) {
      this.context.appendMessage({
        role: "system",
        content:
          "[RESEARCH TURN] The user needs current, sourced information — not a reasoning essay. " +
          "After at most a few sentences of native reasoning, call web_search and web_fetch (and recall_relevant / vault_search when prior briefings may exist). " +
          "Run multiple queries and fetches in parallel when useful. Do not describe tools you plan to call inside reasoning; execute them. " +
          "Cite sources and dates in the final answer.",
      });
    }
    if (
      !openingTurn &&
      this.turnInference?.likelyEditPaths &&
      this.turnInference.likelyEditPaths.length > 0
    ) {
      this.context.appendMessage({
        role: "system",
        content:
          "[INTENT EDIT HINTS] Classifier-suggested repo paths for this turn (prefer opening these first when relevant; ignore if the user contradicts):\n" +
          this.turnInference.likelyEditPaths.map((p) => `- ${p}`).join("\n"),
      });
    }
    this.maybeInjectRuntimeSettingsSnapshot();
    this.maybeInjectRuntimePreferenceRouting(userMessage);

    if (this.config.workingStateEnabled !== false) {
      this.context.initEpistemicState(telemetryUserLabel);
      const b0 = this.context.getContextBudgetAdvice();
      this.context.patchEpistemicState({
        goal: userMessage.slice(0, 2000),
        budget: {
          usagePct: Math.round(b0.usageFraction * 100),
          recallK: b0.recommendedRecallK,
          spareRounds: b0.suggestedMaxExtraRounds,
        },
        harnessNotes: buildToolAwarenessSnapshot(this.registry, this.toolsUsedThisTurn),
        // Restore active hypotheses from the previous turn so multi-turn
        // investigative chains are visible to the model from round 1.
        hypotheses: this.persistedHypotheses.length > 0 ? this.persistedHypotheses : [],
      });
    }
    this.executionState = createDefaultExecutionState(telemetryUserLabel);
    this.syncExecutionStateToContext();
    this.emitter.emit("execution_state", {
      missionId: this.executionState.mission?.id,
      activeContractId: this.executionState.activeContractId,
      driftScore: this.executionState.driftScore,
      milestoneCount: this.executionState.milestones.length,
      contractCount: this.executionState.contracts.length,
    });
    if (!openingTurn) {
      const identityQ = this.turnInference?.identityQuery === true;
      const rewriteOn = resolveHarnessEnvRaw("AGENT_QUERY_REWRITE", this.runtimePreferences) === "1";
      if (identityQ) {
        try {
          this.recallRewriteThisSend = await rewriteQueryForIdentityRecall(
            userMessage,
            this.client,
            this.config.model
          );
        } catch {
          this.recallRewriteThisSend = { subQueries: [userMessage.trim().slice(0, 400)] };
        }
      } else if (rewriteOn) {
        const skipRewriteForExploratory =
          this.turnInference?.exploratoryCreative === true &&
          resolveHarnessEnvRaw("AGENT_QUERY_REWRITE_EXPLORATORY", this.runtimePreferences) !== "1";
        if (skipRewriteForExploratory) {
          this.recallRewriteThisSend = null;
        } else {
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
      }
    }

    if (
      !openingTurn &&
      this.agentDepth === 0 &&
      this.turnInference?.identityProvision === true &&
      this.registry.has("remember")
    ) {
      try {
        const extracted = await extractPreferredNameFromMessage(
          userMessage,
          this.client,
          this.config.model
        );
        if (extracted) {
          await this.dispatcher.directCall("remember", {
            key: extracted.storageKey,
            value: extracted.preferredName,
            scope: "global",
            confidence: 0.95,
          });
          this.context.appendMessage({
            role: "system",
            content:
              `[Identity stored] ${extracted.storageKey} → "${extracted.preferredName}" (global scope). ` +
              "Use this name in replies; do not substitute the OS username.",
          });
        }
      } catch {
        /* optional */
      }
    }

    if (!openingTurn && this.agentDepth === 0 && this.turnInference?.identityQuery === true) {
      try {
        const identityNotes = await loadIdentityNotesFromDisk();
        if (identityNotes.length > 0) {
          this.context.appendMessage({
            role: "user",
            content:
              "[Stored identity facts — authoritative for this turn; do not treat OS account name as the user's name]\n" +
              formatIdentityRecallBlock(identityNotes),
          });
        }
      } catch {
        /* optional */
      }
      this.context.appendMessage({
        role: "system",
        content:
          "[IDENTITY TURN] The user asked about their name. Answer from stored identity notes above and harness recall — " +
          "never guess from the OS account line in world context. If nothing is stored, ask once what to call them and " +
          "call remember({ key: 'user:name', value: '<name>', scope: 'global' }). " +
          "recall_relevant always requires query= (or queries=); never call it with only scope=.",
      });
    }

    try {
      this.emitter.emit("send_start", {
        userMessage: telemetryUserLabel,
        agentDepth: this.agentDepth,
        traceId: this.currentTurnTraceId,
      });

      // Inject world context on the first turn of a root agent (#world-context).
      // Child agents (depth > 0) skip this — they inherit context from their parent.
      if (!this.worldContextInjected && this.agentDepth === 0) {
        this.worldContextInjected = true;
        // Initialize volatile world context refresher at session start.
        this._worldRefresher = new WorldContextRefresher(resolveWorkspaceRoot());
        void this._worldRefresher.init().catch(() => { /* non-fatal */ });
        const worldCtx = await buildWorldContextMessage({
          ...this.config.worldContext,
          firstUserMessage: telemetryUserLabel,
          activeLlm: {
            model: this.config.model,
            baseURL: this.config.baseURL ?? "",
          },
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

      // ACON adaptive compression: inject persisted guidelines so future compressions
      // preserve information that previously caused errors after compression.
      if (this.agentDepth === 0) {
        try {
          const guidelinePreamble = await formatCompressionGuidelines();
          if (guidelinePreamble) {
            this.context.appendCompressionGuidelineNote(guidelinePreamble);
          }
        } catch {
          /* non-fatal */
        }
      }

      this.context.append({ role: "user", content: conversationUserContent });

      // Lazy mode: image attachments are text (data_url in ```attached_images```), not native
      // multimodal input—expose vision_analyze/upload_image before the first model round.
      if (
        !openingTurn &&
        this.registry.isLazyToolLoading() &&
        /\`\`\`attached_images\b/.test(conversationUserContent)
      ) {
        const visionToolNames = (["vision_analyze", "upload_image"] as const).filter((n) =>
          this.registry.has(n)
        );
        if (visionToolNames.length > 0) {
          this.registry.activate(visionToolNames);
          this.context.refreshProtocolDynamic(this.registry.getActiveToolNames());
          this.refreshToolAwareness("vision_auto_activate_attachments");
        }
      }

      if (!openingTurn) {
        this.context.append({
          role: "user",
          content:
            "[SYSTEM NOTE] Capability awareness preface (non-forcing): use this to know all available families/tools, " +
            "then choose the minimal family activation only when needed.\n" +
            buildToolCapabilityManifest(this.registry),
        });
      }

      // Wall-clock abort for one full send(): positive AGENT_SEND_TIMEOUT_MS (typed default),
      // or set to "0" to disable.
      const sendTimeoutRaw =
        parseInt(resolveHarnessEnvRaw("AGENT_SEND_TIMEOUT_MS", this.runtimePreferences) ?? "0", 10) || 0;
      const sendTimeoutMs = sendTimeoutRaw > 0 ? Math.max(30_000, sendTimeoutRaw) : 0;
      // Mid-session world context delta refresh (root agent only, AGENT_WORLD_REFRESH_EVERY).
      if (this.agentDepth === 0 && this._worldRefresher) {
        try {
          const worldDelta = await this._worldRefresher.tick();
          if (worldDelta) this.context.appendMessage(worldDelta);
        } catch {
          /* non-fatal */
        }
      }

      if (sendTimeoutMs > 0) {
        let sendTimeoutId: ReturnType<typeof setTimeout> | undefined;
        const sendTimeoutPromise = new Promise<never>((_, reject) => {
          sendTimeoutId = setTimeout(
            () =>
              reject(
                new Error(
                  `Send timeout after ${Math.round(sendTimeoutMs / 1000)}s. ` +
                    "For large file generation, use write_file mode=create then mode=append, or run_shell with a heredoc."
                )
              ),
            sendTimeoutMs
          );
        });
        try {
          await Promise.race([this.runReActLoop(), sendTimeoutPromise]);
        } finally {
          clearTimeout(sendTimeoutId);
        }
      } else {
        await this.runReActLoop();
      }

      // Episodic recipe/trajectory — off the critical path so `running` clears in `finally`
      // immediately after `turn_end` (status/SSE stay aligned with user-visible completion).
      void this.persistEpisodicRecipeAfterTurn(userMessage);
      if (sessionGreeting) {
        this.sessionGreetingSentThisHarness = true;
      }
      if (personaBootstrapPrompt) {
        this.personaBootstrapPromptSentThisHarness = true;
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
      this.sessionGreetingThisSend = false;
      this.personaBootstrapPromptThisSend = false;
      this.currentTurnController = undefined;
      this.currentTurnTraceId = undefined;
      this.dispatcher.setTurnTraceId(undefined);
      const term = this.lastTurnTerminationReason;
      this.running = false;
      if (term === "ok" && !openingTurn && this.agentDepth === 0) {
        this.armPersonalityHeartbeatAfterIdle();
      }
    }
    });
  }

  /**
   * Opening turn: model greets the user (persona-aware, no tools).
   * No-op when AGENT_SESSION_GREET=0, already sent for this harness, or depth > 0.
   */
  async sendSessionGreeting(): Promise<void> {
    if (resolveHarnessEnvRaw("AGENT_SESSION_GREET", this.runtimePreferences) === "0") return;
    await this.send("", { sessionGreeting: true });
  }

  /** Returns true when runtime preferences show first-run persona bootstrap complete. */
  isPersonaBootstrapCompleted(): boolean {
    return this.runtimePreferences?.persona?.bootstrapCompleted === true;
  }

  getPersistedPersonaProfile(): RuntimePersonaProfile | undefined {
    return this.runtimePreferences?.persona?.activeProfile ?? undefined;
  }

  /**
   * Opening turn: model asks the user how they want the assistant to sound.
   * No-op when disabled, already completed, already prompted, or depth > 0.
   */
  async sendPersonaBootstrapPrompt(): Promise<void> {
    if (resolveHarnessEnvRaw("AGENT_PERSONA_BOOTSTRAP", this.runtimePreferences) === "0") return;
    if (this.isPersonaBootstrapCompleted()) return;
    await this.send("", { personaBootstrapPrompt: true });
  }

  /** Post-turn recipe + trajectory writes (background; does not extend `running`). */
  private async persistEpisodicRecipeAfterTurn(userMessage: string): Promise<void> {
    if (this.toolsUsedThisTurn.length < 4) return;
    // Record the turn as a recipe — keyed by (intent class, phase shape),
    // gated on a good outcome score, merged onto a matching entry if one exists.
    const recipeOutcome = scoreTurnOutcome({
      toolsUsed: this._toolOutcomesThisTurn,
      roundCount: this.roundCount,
      criticPassed: this.criticConsumedThisSend ? true : null,
      contradictionCount: 0,
      terminationReason: "ok",
    });
    try {
      await recordRecipe({
        intentClass: this.turnInference?.intent ?? "general",
        tools: [...this.toolsUsedThisTurn],
        goal: userMessage,
        outcome: recipeOutcome,
      });
    } catch (err) {
      this.emitter.emit("text", {
        delta: `\n[HARNESS] Recipe persist failed: ${err instanceof Error ? err.message : String(err)}\n`,
        channel: "trace",
      });
    }
    if (this.agentDepth === 0 && this.registry.has("remember")) {
      const trajectoryKey = `trajectory:${hashString(userMessage).slice(0, 12)}`;
      const finalAnswer = this.context.getLastAssistantMessage() ?? "";
      const trajectoryValue =
        `GOAL: ${userMessage.slice(0, 120)}\n` +
        `TOOL_SEQUENCE: ${this.toolsUsedThisTurn.join(" → ")}\n` +
        `ROUNDS: ${this.roundCount}\n` +
        `OUTCOME: ${finalAnswer.slice(0, 400)}`;
      try {
        await this.dispatcher.directCall("remember", {
          key: trajectoryKey,
          value: trajectoryValue,
          type: "trajectory",
          actor_id: this.taskId,
        });
      } catch {
        /* non-fatal */
      }
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
    const now = Date.now();
    const inDegradedWindow = now < this.providerDegradedUntilMs;
    const effectiveCap = inDegradedWindow ? this.spawnConcurrencyCap : this.maxConcurrentAgents;
    if (!inDegradedWindow && this.spawnConcurrencyCap < this.maxConcurrentAgents) {
      this.spawnConcurrencyCap = Math.min(this.maxConcurrentAgents, this.spawnConcurrencyCap + 1);
    }
    if (running >= effectiveCap) {
      throw new Error(
        `Max concurrent agents (${effectiveCap}) reached — wait for some to complete before spawning more`
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

    // NOTE: copyLazyPolicyFromParent is called AFTER onChildCreated below.
    // It must run after all tools are registered so harness-scoped tools
    // (spawn_agent, check_context, etc.) are included in the seeded active set.

    const inheritedPersonaMsg = this.context.getEffectiveInception()[0]!;
    const personaMsg =
      childConfig.inheritPersona === true ? inheritedPersonaMsg : buildNeutralChildPersonaMessage();
    const coreRaw = this.config.context.inceptionMessages[1];
    const coreStr = typeof coreRaw?.content === "string" ? coreRaw.content : "";
    const contractPrelude = buildSpawnContractPrelude(childConfig.spawnContract);
    const subtaskTail: Message[] = childConfig.additionalContext
      ? [
          {
            role: "user" as const,
            content: `[SUBTASK CONTEXT] ${childConfig.additionalContext}`,
          },
        ]
      : [];
    if (contractPrelude) {
      subtaskTail.unshift({ role: "user" as const, content: contractPrelude });
    }
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
      // Child inherits the parent's workspace root unless ChildAgentConfig overrides it
      // (e.g. for a git_worktree-isolated sub-agent).
      workspaceRoot: childConfig.workspaceRoot ?? this.workspaceRoot,
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
      // Propagate shared bus so siblings can communicate via publish/subscribe.
      sharedBus: this.sharedBus,
    });

    // Replace child's empty registry with the scoped one
    childHarness.registry = childRegistry;
    childHarness.abortSignal = abortController.signal;

    // Propagate hook so depth-2+ children get harness-scoped tools (orchestration, context, …).
    // Only the root had this set from registerAllTools — without inheritance, grandchildren
    // would keep a stripped registry and never re-register.
    childHarness.onChildCreated = this.onChildCreated;
    childHarness.onTurnEndCleanup = this.onTurnEndCleanup;

    // Notify external code (orchestration tools) to register child-scoped tools
    // (e.g. spawn_agent closing over childHarness for grandchild support)
    if (depthAllowsOrchestration) {
      this.onChildCreated?.(childHarness);
    }

    // Seed child active set AFTER onChildCreated so harness-scoped tools
    // (spawn_agent, wait_for_agents, check_context, …) are included.
    childRegistry.copyLazyPolicyFromParent(this.registry);

    if (childConfig.spawnContract && childRegistry.isLazyToolLoading()) {
      const mapped = mapContractToToolFamilies(
        childConfig.spawnContract.objective,
        childConfig.spawnContract.role
      );
      childRegistry.activateFamilies(mapped.families);
    }

    // Force-activate any explicitly requested tools regardless of parent's active set.
    // This lets the spawner provision web, vault, shell, etc. for sub-agents that need
    // capabilities the parent hasn't activated in lazy mode.
    if (childConfig.activateTools?.length) {
      childRegistry.activate(childConfig.activateTools);
    }

    const dyn =
      this.config.context.protocolDynamicBuilder?.(childHarness.registry.getActiveToolNames()) ??
      "";
    const customSystemMsg: Message[] = childConfig.systemPrompt?.trim()
      ? [{ role: "system" as const, content: childConfig.systemPrompt.trim() }]
      : [];
    childHarness.getContext().setInceptionOverride([
      personaMsg,
      {
        role: "system",
        content: coreStr + (dyn.trim() ? `\n\n${dyn.trim()}` : ""),
      },
      ...subtaskTail,
      ...customSystemMsg,
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
      dependsOn: childConfig.dependsOn,
    });

    // ── Emit spawned event ──────────────────────────────────────────────────
    this.emitter.emit("subtask_spawned", {
      taskId: childId,
      parentTaskId: this.taskId,
      goal: childConfig.goal,
      depth: childDepth,
      contractSource: childConfig.spawnContractSource ?? (childConfig.spawnContract ? "provided" : "synthesized"),
      role: childConfig.spawnContract?.role,
    });
    if (childConfig.spawnContract) {
      this.emitter.emit("spawn_contract_created", {
        taskId: childId,
        source: childConfig.spawnContractSource ?? "provided",
        role: childConfig.spawnContract.role,
        objective: childConfig.spawnContract.objective,
      });
      this.emitter.emit("spawn_contract_applied", {
        taskId: childId,
        role: childConfig.spawnContract.role,
        deliverableFormat: childConfig.spawnContract.deliverableFormat,
        allowedTools: childConfig.spawnContract.allowedTools ?? [],
      });
    }

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

        Promise.resolve()
          .then(async () => {
            if (childConfig.dependsOn && childConfig.dependsOn.length > 0) {
              const dep = await this.orchestrator.waitForDependencies(childId, timeoutMs);
              if (!dep.ok) {
                const reason = `Dependencies failed: ${dep.failedIds.join(", ")}`;
                this.emitter.emit("spawn_contract_violation", {
                  taskId: childId,
                  reason,
                  severity: "high",
                });
                throw new Error(reason);
              }
            }
            return childHarness.send(
              childConfig.userPrompt?.trim() ?? childConfig.taskBrief?.trim() ?? childConfig.goal
            );
          })
          .then(() => {
            clearTimeout(timeoutId);
            const output = childHarness.getLastAssistantMessage();
            const handoffKey = `spawn/${this.taskId}/${childId}/handoff`;
            const handoff = {
              type: "handoff" as const,
              summary: output.slice(0, 500),
              evidenceRefs: childConfig.spawnContract?.handoffRequirements ?? [],
              payload: output.slice(0, 4000),
              at: Date.now(),
            };
            this.sharedBus.publishEnvelope(handoffKey, handoff, childId);
            this.emitter.emit("subtask_handoff_written", {
              taskId: childId,
              key: handoffKey,
              bytes: JSON.stringify(handoff).length,
            });
            this.orchestrator.complete(childId, output);
            this.emitter.emit("subtask_complete", {
              taskId: childId,
              ok: true,
              output,
              rounds: childHarness.roundCount,
              handoffWritten: true,
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
              handoffWritten: false,
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
    // Explicit opt-in only: avoid silent auto-capture into vault.
    if (resolveHarnessEnvRaw("AGENT_MEMORY_EPISODE", this.runtimePreferences) !== "1") return;
    if (this.sessionGreetingThisSend || this.personaBootstrapPromptThisSend) return;
    if (this.agentDepth > 0) return;
    if (!resolveHarnessEnvRaw("AGENT_VAULT_PATH", this.runtimePreferences)?.trim()) return;
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
    if (resolveHarnessEnvRaw("AGENT_MEMORY_AUTO_EXTRACT", this.runtimePreferences) === "0") return;
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

  /** AutoDream-style background memory consolidation over recent sessions (env-gated). */
  private async maybeAutoDreamConsolidation(): Promise<void> {
    // Opening-turn sends (greeting / persona-bootstrap prompt) clear these flags only in
    // send()'s `finally` after runReActLoop returns. If we start auto-dream from the tail of
    // runReActLoop, the microtask can run before `finally`, which used to emit a misleading
    // auto_dream gate: bootstrap_state · session_bootstrap_active (telemetry only, but reads
    // like the harness is stuck). Skip entirely while those sends are in flight.
    if (this.sessionGreetingThisSend || this.personaBootstrapPromptThisSend) {
      return;
    }
    const cfg = resolveAutoDreamConfig();
    const runId = `dream-${Date.now()}`;
    const emitGate = (
      name: string,
      passed: boolean,
      reason?: string,
      value?: string | number | boolean
    ): void => {
      this.emitter.emit("auto_dream", {
        stage: "gate",
        runId,
        gate: { name, passed, ...(reason ? { reason } : {}), ...(value !== undefined ? { value } : {}) },
      });
    };
    emitGate("enabled", cfg.enabled, cfg.enabled ? "auto_dream_enabled" : "disabled");
    if (!cfg.enabled) return;
    emitGate("agent_depth", this.agentDepth === 0, this.agentDepth === 0 ? "root_agent" : "child_agent", this.agentDepth);
    if (this.agentDepth > 0) return;
    const notBootstrap = !this.sessionGreetingThisSend && !this.personaBootstrapPromptThisSend;
    emitGate("bootstrap_state", notBootstrap, notBootstrap ? "ready" : "session_bootstrap_active");
    if (!notBootstrap) return;
    const hasRemember = this.registry.has("remember");
    emitGate("remember_tool", hasRemember, hasRemember ? "tool_available" : "remember_tool_missing");
    if (!hasRemember) return;
    const hasSessionSignals = this.toolsUsedThisTurn.length > 0 || this.roundCount > 0;
    emitGate("session_signals", hasSessionSignals, hasSessionSignals ? "has_turn_activity" : "no_turn_activity");
    if (!hasSessionSignals) return;

    const lastAt = await readLastConsolidatedAt();
    const hoursSince = (Date.now() - lastAt) / 3_600_000;
    emitGate("min_hours", hoursSince >= cfg.minHours, hoursSince >= cfg.minHours ? "time_gate_passed" : "waiting_for_hours", Number(hoursSince.toFixed(2)));
    if (hoursSince < cfg.minHours) return;

    const sinceScan = Date.now() - this.lastAutoDreamScanAt;
    emitGate("scan_interval", sinceScan >= cfg.scanIntervalMs, sinceScan >= cfg.scanIntervalMs ? "scan_due" : "scan_throttled_ms", sinceScan);
    if (sinceScan < cfg.scanIntervalMs) return;
    this.lastAutoDreamScanAt = Date.now();

    const sessionIds = await listSessionsTouchedSince(lastAt, this.taskId);
    emitGate("min_sessions", sessionIds.length >= cfg.minSessions, sessionIds.length >= cfg.minSessions ? "session_gate_passed" : "waiting_for_sessions", sessionIds.length);
    if (sessionIds.length < cfg.minSessions) return;

    const priorMtime = await tryAcquireConsolidationLock(cfg.lockStaleMs);
    emitGate("lock", priorMtime !== null, priorMtime !== null ? "lock_acquired" : "lock_held_elsewhere");
    if (priorMtime === null) return;
    const dreamStartedAt = Date.now();
    this.emitter.emit("auto_dream", {
      stage: "started",
      runId,
      progress: { step: "started", sessionsFound: sessionIds.length },
    });

    try {
      const snippets = await loadRecentSessionSnippets(
        sessionIds,
        cfg.maxSessionFiles,
        cfg.maxCharsPerSession,
        cfg.maxTotalChars
      );
      this.emitter.emit("auto_dream", {
        stage: "progress",
        runId,
        progress: { step: "snippets_loaded", sessionsFound: sessionIds.length, snippetsLoaded: snippets.length },
      });
      const notesPathResolved = await (
        await import("./global_storage.js")
      ).pickReadPath((await import("./global_storage.js")).notesPaths());
      const notesSnapshot = await readFileFs(notesPathResolved, "utf8")
        .then((s) => s.slice(0, 30_000))
        .catch(() => "(no notes yet)");
      const prompt = buildAutoDreamPrompt({ notesSnapshot, sessions: snippets });

      const fast = getFastModelSlug(this.config.model);
      const jr = await completeChatJson(this.client, {
        model: fast,
        temperature: 0,
        maxTokens: 1000,
        messages: [
          {
            role: "system",
            content:
              "You produce strict JSON memory consolidation operations. No markdown fences, no prose outside JSON.",
          },
          { role: "user", content: prompt },
        ],
      });
      if (!jr.ok || typeof jr.parsed !== "object" || jr.parsed === null) {
        this.emitter.emit("auto_dream", {
          stage: "failed",
          runId,
          error: "model_json_unavailable",
        });
        return;
      }
      this.emitter.emit("auto_dream", {
        stage: "progress",
        runId,
        progress: { step: "model_parsed", sessionsFound: sessionIds.length, snippetsLoaded: snippets.length },
      });
      const parsed = jr.parsed as {
        summary?: string;
        upserts?: Array<{ type?: string; key?: string; value?: string }>;
        deletes?: Array<{ key?: string; reason?: string }>;
      };
      const allowed = new Set(["fact", "experience", "entity", "belief", "reflection", "recipe"]);
      let upsertsApplied = 0;
      for (const u of parsed.upserts?.slice(0, 16) ?? []) {
        if (!u || typeof u.key !== "string" || typeof u.value !== "string") continue;
        const key = u.key.trim().slice(0, 80);
        const value = u.value.trim().slice(0, 4000);
        if (!key || value.length < 12) continue;
        const typ = typeof u.type === "string" ? u.type.trim() : "";
        if (typ && !allowed.has(typ)) continue;
        await this.dispatcher.directCall("remember", {
          key,
          value,
          ...(typ ? { type: typ } : {}),
        });
        upsertsApplied++;
      }
      this.emitter.emit("auto_dream", {
        stage: "progress",
        runId,
        progress: { step: "upserts_applied", upserts: upsertsApplied },
      });
      const allowDelete = resolveHarnessEnvRaw("AGENT_AUTO_DREAM_ALLOW_DELETE", this.runtimePreferences) === "1";
      let deletesApplied = 0;
      if (allowDelete && this.registry.has("forget")) {
        for (const d of parsed.deletes?.slice(0, 8) ?? []) {
          if (!d || typeof d.key !== "string") continue;
          const key = d.key.trim().slice(0, 120);
          if (!key) continue;
          await this.dispatcher.directCall("forget", { key });
          deletesApplied++;
        }
      }
      this.emitter.emit("auto_dream", {
        stage: "progress",
        runId,
        progress: { step: "deletes_applied", deletes: deletesApplied, upserts: upsertsApplied },
      });
      const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
      if (summary && resolveAutoDreamInjectTranscript(this.runtimePreferences)) {
        this.context.appendMessage(buildAutoDreamTranscriptMessage(summary));
      }
      this.emitter.emit("auto_dream", {
        stage: "completed",
        runId,
        result: {
          ...(summary ? { summary: summary.slice(0, 400) } : {}),
          upserts: upsertsApplied,
          deletes: deletesApplied,
          durationMs: Date.now() - dreamStartedAt,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.emitter.emit("auto_dream", {
        stage: "failed",
        runId,
        error: msg.slice(0, 500),
      });
      await rollbackConsolidationLock(priorMtime);
    }
  }

  private clearPersonalityHeartbeatSchedule(): void {
    if (this.personalityHeartbeatIdleTimer != null) {
      clearTimeout(this.personalityHeartbeatIdleTimer);
      this.personalityHeartbeatIdleTimer = null;
    }
  }

  /** Debounced idle timer after a successful root turn (see AGENT_HEARTBEAT). */
  private armPersonalityHeartbeatAfterIdle(): void {
    const cfg = resolvePersonalityHeartbeatConfig(this.runtimePreferences);
    if (!cfg.enabled) return;
    this.clearPersonalityHeartbeatSchedule();
    this.emitter.emit("heartbeat_scheduled", {
      taskId: this.taskId,
      firesAtMs: Date.now() + cfg.idleMs,
      idleMs: cfg.idleMs,
    });
    this.personalityHeartbeatIdleTimer = setTimeout(() => {
      this.personalityHeartbeatIdleTimer = null;
      void this.runPersonalityHeartbeatIfEligible();
    }, cfg.idleMs);
  }

  private async runPersonalityHeartbeatIfEligible(): Promise<void> {
    const cfg = resolvePersonalityHeartbeatConfig(this.runtimePreferences);
    const skip = (reason: string, detail?: string) => {
      this.emitter.emit("heartbeat_skipped", { taskId: this.taskId, reason, ...(detail ? { detail } : {}) });
    };
    if (!cfg.enabled) {
      skip("disabled");
      return;
    }
    if (this.agentDepth !== 0) {
      skip("depth", String(this.agentDepth));
      return;
    }
    if (this.running) {
      skip("busy");
      return;
    }
    if (this.personalityHeartbeatRunning) {
      skip("single_flight");
      return;
    }
    const sinceLast = Date.now() - this.lastPersonalityHeartbeatCompletedAt;
    if (this.lastPersonalityHeartbeatCompletedAt > 0 && sinceLast < cfg.minIntervalMs) {
      skip("rate_limited", `wait_ms=${cfg.minIntervalMs - sinceLast}`);
      return;
    }

    this.personalityHeartbeatRunning = true;
    const runId = `hb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.emitter.emit("heartbeat_started", { taskId: this.taskId, runId });

    const hourAgo = Date.now() - 3_600_000;
    const nudgeWindow = this.personalityHeartbeatNudgeTimestampsMs.filter((t) => t > hourAgo);

    try {
      const persona = this.getCurrentPersona();
      const personaLabel = persona?.name?.trim() || "Assistant";
      const result = await executePersonalityHeartbeat({
        prefs: this.runtimePreferences,
        client: this.client,
        mainModelSlug: this.config.model,
        dispatcher: this.dispatcher,
        taskId: this.taskId,
        runId,
        personaLabel,
        lastUserMessage: this.lastUserMessage,
        toolsUsedThisTurn: [...this.toolsUsedThisTurn],
        registryHas: (name) => this.registry.has(name),
        nudgeTimestampsHour: nudgeWindow,
      });

      this.lastPersonalityHeartbeatCompletedAt = Date.now();

      if (result.error) {
        await appendPersonalityHeartbeatLog({
          ts: new Date().toISOString(),
          taskId: this.taskId,
          runId: result.runId,
          trigger: "idle_tick",
          summary: result.summary,
          surfaceDecision: "none",
          skippedReason: result.error,
          durationMs: result.durationMs,
        });
        this.emitter.emit("heartbeat_skipped", {
          taskId: this.taskId,
          reason: "tick_failed",
          detail: result.error.slice(0, 240),
        });
        return;
      }

      if (result.surfaceDecision !== "none" && result.nudgeText) {
        const now = Date.now();
        this.personalityHeartbeatNudgeTimestampsMs = [...nudgeWindow, now];
      }
      if (result.surfaceDecision === "trace" && result.nudgeText) {
        this.emitter.emit("text", {
          delta: `\n[Pulse] ${result.nudgeText}\n`,
          channel: "trace",
        });
      }

      await appendPersonalityHeartbeatLog({
        ts: new Date().toISOString(),
        taskId: this.taskId,
        runId: result.runId,
        trigger: "idle_tick",
        summary: result.summary,
        reflections: result.reflectionsPreview,
        memoryWrites: result.memoryWrites,
        surfaceDecision: result.surfaceDecision,
        ...(result.nudgeText ? { nudgeText: result.nudgeText } : {}),
        durationMs: result.durationMs,
      });

      this.emitter.emit("heartbeat_completed", {
        taskId: this.taskId,
        runId: result.runId,
        summary: result.summary,
        durationMs: result.durationMs,
        reflectionsPreview: result.reflectionsPreview,
        memoryWrites: result.memoryWrites,
        surfaceDecision: result.surfaceDecision,
        ...(result.nudgeText ? { nudgeText: result.nudgeText } : {}),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.emitter.emit("heartbeat_skipped", {
        taskId: this.taskId,
        reason: "exception",
        detail: msg.slice(0, 300),
      });
    } finally {
      this.personalityHeartbeatRunning = false;
    }
  }

  /** Run auto-dream off the critical response path. */
  private triggerAutoDreamConsolidationBackground(): void {
    if (this.autoDreamBackgroundRunning) return;
    this.autoDreamBackgroundRunning = true;
    void this.maybeAutoDreamConsolidation()
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.emitter.emit("auto_dream", {
          stage: "failed",
          runId: `dream-bg-${Date.now()}`,
          error: msg.slice(0, 500),
        });
      })
      .finally(() => {
        this.autoDreamBackgroundRunning = false;
      });
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
      Math.min(20, parseInt(resolveHarnessEnvRaw("AGENT_VAULT_WRITE_BUDGET", this.runtimePreferences) ?? "8", 10) || 8)
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

    const dedupeOn = resolveHarnessEnvRaw("AGENT_VAULT_DEDUPE", this.runtimePreferences) !== "0";
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
    this.lastTurnTerminationReason = reason;
    // Persist active hypotheses for the next send() so multi-turn investigative chains survive.
    const es = this.context.getEpistemicState();
    if (es?.hypotheses?.length) {
      this.persistedHypotheses = es.hypotheses.filter(
        (h) => !h.status || h.status === "active"
      ).slice(0, 10);
    } else {
      this.persistedHypotheses = [];
    }
    const snapshot = this.context.snapshot();
    this.emitter.emit("turn_end", {
      contextSnapshot: snapshot,
      durationMs: Date.now() - this.sendStartTime,
      harnessMetrics: this.buildHarnessMetrics(reason),
      traceId: this.currentTurnTraceId,
    });
    const cleanup = this.onTurnEndCleanup;
    if (cleanup) {
      void Promise.resolve(cleanup(this.taskId)).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.emitter.emit("text", {
          delta: `\n[HARNESS] turn_end cleanup failed: ${msg}\n`,
          channel: "trace",
        });
      });
    }
  }

  /**
   * Abort the current in-progress turn. No-op when idle.
   * Triggers the stream abort path — the harness will emit turn_end with reason "error".
   */
  abortCurrentTurn(): void {
    this.currentTurnController?.abort();
  }

  private mergeStreamAbortSignals(streamAbort?: AbortController): AbortSignal | undefined {
    const parts: AbortSignal[] = [];
    if (this.abortSignal) parts.push(this.abortSignal);
    if (this.currentTurnController) parts.push(this.currentTurnController.signal);
    if (streamAbort) parts.push(streamAbort.signal);
    if (parts.length === 0) return undefined;
    if (parts.length === 1) return parts[0];
    const linked = new AbortController();
    for (const sig of parts) {
      if (sig.aborted) {
        linked.abort();
        return linked.signal;
      }
      sig.addEventListener("abort", () => linked.abort(), { once: true });
    }
    return linked.signal;
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
    this.dispatcher.advanceTurnRound();
    this.syncExecutionStateToContext();
    const contractBudgetMsg = this.checkContractBudgetExceeded();
    if (contractBudgetMsg) {
      this.context.appendMessage({
        role: "user",
        content:
          `[CONTRACT BUDGET] ${contractBudgetMsg} ` +
          (this.registry.has("verify_contract")
            ? "Call verify_contract to assess partial progress, then finalize your answer."
            : "Stop calling tools and finalize your answer with what you have verified."),
      });
      if (!this.registry.has("verify_contract") || this.roundCount >= this.config.maxToolRoundsPerTurn - 1) {
        this.emitTurnEnd("contract_budget");
        return;
      }
    }
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
        if (triggeredReplan) {
          void this.maybePlaybackCompensation("drift replan threshold");
        }
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

    // Session yield point — crash-recovery snapshot every AGENT_YIELD_EVERY_N rounds.
    {
      const yieldEvery = parseInt(resolveHarnessEnvRaw("AGENT_YIELD_EVERY_N", this.runtimePreferences) ?? "0", 10);
      if (yieldEvery > 0 && this.agentDepth === 0 && this.roundCount % yieldEvery === 0) {
        const ctxSnap = this.context.snapshot();
        const es = this.context.getEpistemicState();
        const epSummary = es
          ? es.subgoals.map((g) => `[${g.status}] ${g.id}${g.note ? ": " + g.note : ""}`).join("; ")
          : undefined;
        void writeYieldSnapshot({
          taskId: this.taskId,
          round: this.roundCount,
          goal: this.lastUserMessage.slice(0, 2000),
          toolsUsed: [...this.toolsUsedThisTurn],
          usageFraction: ctxSnap.usageFraction,
          tokenCount: ctxSnap.tokenCount,
          epistemicSummary: epSummary,
          savedAt: new Date().toISOString(),
        });
      }
    }

    if (
      round === 1 &&
      resolveHarnessEnvRaw("AGENT_RULE_RECALL", this.runtimePreferences) !== "0" &&
      !this.ruleRecallInjectedThisSend &&
      !this.sessionGreetingThisSend &&
      !this.personaBootstrapPromptThisSend
    ) {
      this.ruleRecallInjectedThisSend = true;
      let ruleMsg: string;
      try {
        const [hitCounts, demoted] = await Promise.all([
          getRuleHitCounts(),
          getDemotedRuleIds(),
        ]);
        ruleMsg = buildHarnessRuleRecallMessage(hitCounts, demoted);
      } catch {
        ruleMsg = buildHarnessRuleRecallMessage(new Map());
      }
      this.context.appendMessage({ role: "system", content: ruleMsg });
      this.injectedRuleIdsThisSend = extractRuleIds(ruleMsg);
    }

    // ResearchLedger: when the ledger has changed since the last injection,
    // append a compact [RESEARCH STATE] block so the model knows what it has
    // already searched, what URLs are pending, and what fetches succeeded or
    // failed. Empty / version-stable ledgers add zero overhead.
    const ledgerVersion = this._researchLedger.getVersion();
    if (
      !this._researchLedger.isEmpty() &&
      ledgerVersion !== this._lastResearchLedgerInjectedVersion
    ) {
      const block = this._researchLedger.formatContextBlock();
      if (block) {
        this.context.appendMessage({ role: "system", content: block });
        this._lastResearchLedgerInjectedVersion = ledgerVersion;
      }
    }

    this.context.refreshProtocolDynamic(this.registry.getActiveToolNames());
    this.refreshToolAwareness("protocol_dynamic_refresh");

    // Context pressure alerts (#9): fire once per threshold per turn
    const snapBefore = this.context.snapshot();
    const pctBefore = Math.round(snapBefore.usageFraction * 100);
    if (pctBefore >= 85 && !this.contextAlertFired85) {
      this.contextAlertFired85 = true;
      this.context.appendMessage({
        role: "system",
        content:
          `[CONTEXT BUDGET — harness notice, not user speech]\n` +
          `CONTEXT BUDGET CRITICAL: ${pctBefore}% used — call compress_context() immediately or early context will be lost.`,
      });
    } else if (pctBefore >= 60 && !this.contextAlertFired60) {
      this.contextAlertFired60 = true;
      this.context.appendMessage({
        role: "system",
        content:
          `[CONTEXT BUDGET — harness notice, not user speech]\n` +
          `CONTEXT BUDGET: ${pctBefore}% used — consider calling compress_context() before continuing long tasks.`,
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

    const recallEvery = parseInt(resolveHarnessEnvRaw("AGENT_RECALL_EVERY_N", this.runtimePreferences) ?? "2", 10);
    const intent = this.turnInference?.intent ?? "knowledge";
    const memoryPolicy = resolveMemoryPolicy(intent, {
      identityQuery: this.turnInference?.identityQuery === true,
      exploratoryCreative: this.turnInference?.exploratoryCreative === true,
    });
    const inferenceThreshold = resolveIntentConfidenceThreshold();
    // Emit routing policy once per turn (round 0 only) — the intent/policy is stable
    // for the full turn; re-emitting on every round creates noisy UI repetition.
    if (this.agentDepth === 0 && round === 0) {
      this.emitter.emit("memory_retrieval_policy", {
        intent,
        likelyEditPaths: this.turnInference?.likelyEditPaths?.length
          ? [...this.turnInference.likelyEditPaths]
          : undefined,
        source: this.turnInference?.source ?? "turn_policy",
        confidence: this.turnInference?.confidence,
        threshold: inferenceThreshold,
        scope: memoryPolicy.scope,
        maxAgeDays: memoryPolicy.maxAgeDays,
        minConfidence: memoryPolicy.minConfidence,
        minQueryOverlap: memoryPolicy.minQueryOverlap,
        excludeTypes: memoryPolicy.excludeTypes ?? [],
        autoRecallAllowed: memoryPolicy.allowAutoRecall,
        fallbackReason: this.turnInference?.fallbackReason,
        exploratoryCreative: Boolean(this.turnInference?.exploratoryCreative),
      });
    }
    const round0PrimeEnabled = resolveHarnessEnvRaw("AGENT_MEMORY_PRIME_ROUND0", this.runtimePreferences) !== "0";
    // ── Semantic dream gating ─────────────────────────────────────────────────
    // Load notes index once per recall check for BM25 scoring.
    // If score < threshold, skip the recall call (save tokens + latency).
    const dreamThresholdRaw = resolveHarnessEnvRaw("AGENT_DREAM_THRESHOLD", this.runtimePreferences) ?? "0.15";
    const dreamThreshold = Math.max(0, Math.min(1, Number(dreamThresholdRaw) || 0.15));
    let dreamScorePassedGate = true;
    if (dreamThreshold > 0 && this.agentDepth === 0 && memoryPolicy.allowAutoRecall && this.lastUserMessage.trim().length > 8) {
      try {
        const { notesPaths: _notesPaths, pickReadPath: _pickReadPath } = await import(
          "./global_storage.js"
        );
        const notesPathResolved = await _pickReadPath(_notesPaths());
        const notesRaw = await readFileFs(notesPathResolved, "utf8").catch(() => "{}");
        const notesObj = JSON.parse(notesRaw) as Record<string, { value?: string; text?: string }>;
        const docs: RankableDoc[] = Object.entries(notesObj).map(([id, n]) => ({
          id,
          text: (n.value ?? n.text ?? "").slice(0, 1000),
        }));
        if (docs.length > 0) {
          const score = scoreTurnAgainstIndex(this.lastUserMessage.slice(0, 400), docs);
          dreamScorePassedGate = score >= dreamThreshold;
          if (!dreamScorePassedGate) {
            this.emitter.emit("text", {
              delta: `[dream-gate: score=${score.toFixed(3)} < threshold=${dreamThreshold} — skipping auto-recall]\n`,
              channel: "trace",
            });
          }
        }
      } catch {
        /* non-fatal — gate open on error */
      }
    }
    const identityLike = this.turnInference?.identityQuery === true;
    // Name questions rarely lexically match stored notes — don't block harness recall.
    if (identityLike) dreamScorePassedGate = true;
    const shouldPrimeThisRound = shouldPrimeMemoryThisRound({
      recallEvery,
      round,
      round0PrimeEnabled,
      dreamScorePassedGate,
    });
    if (
      shouldPrimeThisRound &&
      this.agentDepth === 0 &&
      !this.sessionGreetingThisSend &&
      !this.personaBootstrapPromptThisSend &&
      memoryPolicy.allowAutoRecall &&
      (this.registry.has("recall_relevant") || this.registry.has("memory_query"))
    ) {
      try {
        const seed = this.lastUserMessage.trim().slice(0, 400);
        const rw = this.recallRewriteThisSend;
        const sub =
          rw?.subQueries?.filter((q) => q.trim().length >= 4) ?? [];
        const identityLike = this.turnInference?.identityQuery === true;
        // Identity queries get purpose-built BM25 seeds first — the raw question
        // ("do you know my name?") has zero lexical overlap with stored name facts.
        let queries: string[] = [];
        let identityHyde: string | undefined;
        if (identityLike) {
          try {
            const ir = await rewriteQueryForIdentityRecall(
              this.lastUserMessage,
              this.client,
              this.config.model
            );
            queries = ir.subQueries.filter((q) => q.trim().length >= 3);
            identityHyde = ir.hyde?.trim();
          } catch {
            queries = seed.length >= 4 ? [seed] : [this.lastUserMessage.trim().slice(0, 400)];
          }
        } else if (sub.length > 0) {
          queries = sub;
        } else if (seed.length >= 8) {
          queries = [seed];
        }
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
                scope: memoryPolicy.scope,
                goal_hint: (() => {
                  const base = this.lastUserMessage.slice(0, 500);
                  const paths =
                    intent === "coding" && this.turnInference?.likelyEditPaths?.length
                      ? this.turnInference.likelyEditPaths.slice(0, 8).join(", ")
                      : "";
                  if (!paths) return base;
                  const suffix = `\nLikely code paths: ${paths}`;
                  return base.length + suffix.length > 900 ? base.slice(0, 900 - suffix.length) + suffix : base + suffix;
                })(),
                open_questions:
                  rw?.subQueries?.filter((q) => q.trim().length >= 4).slice(0, 8) ?? [],
                ...(memoryPolicy.maxAgeDays != null ? { max_age_days: memoryPolicy.maxAgeDays } : {}),
                ...(memoryPolicy.minConfidence != null
                  ? { min_confidence: memoryPolicy.minConfidence }
                  : {}),
                ...(memoryPolicy.minQueryOverlap != null
                  ? { min_query_overlap: memoryPolicy.minQueryOverlap }
                  : {}),
                ...(memoryPolicy.excludeTypes?.length
                  ? { exclude_types: memoryPolicy.excludeTypes }
                  : {}),
              }
            : {
                query: queries[0]!.slice(0, 800),
                queries,
                k,
                scope: memoryPolicy.scope,
                ...(memoryPolicy.maxAgeDays != null ? { max_age_days: memoryPolicy.maxAgeDays } : {}),
                ...(memoryPolicy.minConfidence != null
                  ? { min_confidence: memoryPolicy.minConfidence }
                  : {}),
                ...(memoryPolicy.minQueryOverlap != null
                  ? { min_query_overlap: memoryPolicy.minQueryOverlap }
                  : {}),
                ...(memoryPolicy.excludeTypes?.length
                  ? { exclude_types: memoryPolicy.excludeTypes }
                  : {}),
              };
          if (identityHyde) payload["hyde"] = identityHyde.slice(0, 1500);
          else if (rw?.hyde?.trim()) payload["hyde"] = rw.hyde.trim().slice(0, 1500);
          if (identityLike) payload["workspace_scope"] = "all";
          this.emitter.emit("memory_retrieval_policy", {
            intent,
            likelyEditPaths: this.turnInference?.likelyEditPaths?.length
              ? [...this.turnInference.likelyEditPaths]
              : undefined,
            source: useMq ? "memory_query" : "recall_relevant",
            confidence: this.turnInference?.confidence,
            threshold: inferenceThreshold,
            scope: memoryPolicy.scope,
            maxAgeDays: memoryPolicy.maxAgeDays,
            minConfidence: memoryPolicy.minConfidence,
            minQueryOverlap: memoryPolicy.minQueryOverlap,
            excludeTypes: memoryPolicy.excludeTypes ?? [],
            autoRecallAllowed: memoryPolicy.allowAutoRecall,
            fallbackReason: this.turnInference?.fallbackReason,
            exploratoryCreative: Boolean(this.turnInference?.exploratoryCreative),
          });
          const r = await this.dispatcher.directCall(useMq ? "memory_query" : "recall_relevant", payload);
          if (
            r.ok &&
            typeof r.output === "string" &&
            r.output.trim().length > 20 &&
            hasUsefulRecallPayload(r.output, seed, memoryPolicy.minQueryOverlap ?? 0.05, {
              identityLike,
            })
          ) {
            // ── Contradiction detection ───────────────────────────────────────
            // Compare recalled notes against recent tool results in the last 3 turns.
            const autoResolve = resolveHarnessEnvRaw("AGENT_DREAM_CONTRADICT_AUTO_RESOLVE", this.runtimePreferences) !== "0";
            const contradictThreshold = Math.max(0, Math.min(1,
              Number(resolveHarnessEnvRaw("AGENT_DREAM_CONTRADICT_CONFIDENCE", this.runtimePreferences) ?? "0.85") || 0.85
            ));
            if (autoResolve && contradictThreshold > 0) {
              try {
                // Collect recent tool output strings from context (last 3 rounds)
                const recentOutputs: string[] = [];
                const allMsgs = this.context.buildMessagesSync();
                for (let mi = allMsgs.length - 1; mi >= 0 && recentOutputs.length < 6; mi--) {
                  const m = allMsgs[mi];
                  if (m && m.role === "tool" && typeof m.content === "string") {
                    recentOutputs.push(m.content.slice(0, 800));
                  }
                }
                // Parse recalled output into note-like objects
                const recalledNotes = r.output
                  .split("\n---\n")
                  .map((s) => ({ text: s.trim() }))
                  .filter((n) => n.text.length > 10);
                const contradictions = detectContradictions(recalledNotes, recentOutputs, {
                  confidenceThreshold: contradictThreshold,
                });
                for (const c of contradictions) {
                  if (c.confidence >= contradictThreshold && c.noteKey) {
                    try {
                      await this.dispatcher.directCall("remember", {
                        key: c.noteKey,
                        value: c.freshFact,
                        overwrite: true,
                      });
                      this.emitter.emit("text", {
                        delta: `[MEMORY CONFLICT RESOLVED: key=${c.noteKey} stale="${c.staleClaim}" → updated from fresh evidence]\n`,
                        channel: "trace",
                      });
                    } catch { /* non-fatal */ }
                  }
                }
              } catch { /* non-fatal */ }
            }
            this.context.appendMessage({
              role: "user",
              content: `[Relevant memory — mid-turn recall]\n${r.output.slice(0, 3500)}`,
            });
          }
        }

        if (identityLike) {
          const diskNotes = await loadIdentityNotesFromDisk();
          if (diskNotes.length > 0) {
            this.context.appendMessage({
              role: "user",
              content: `[Identity recall — on-disk user:/identity:/pref: notes]\n${formatIdentityRecallBlock(diskNotes)}`,
            });
          }
        }
      } catch {
        /* optional */
      }
    }
    if (round > 0 && round % recallEvery === 0 && this.agentDepth === 0 && !memoryPolicy.allowAutoRecall) {
      this.emitter.emit("memory_retrieval_policy", {
        intent,
        source: "auto_recall",
        confidence: this.turnInference?.confidence,
        threshold: inferenceThreshold,
        scope: memoryPolicy.scope,
        maxAgeDays: memoryPolicy.maxAgeDays,
        minConfidence: memoryPolicy.minConfidence,
        minQueryOverlap: memoryPolicy.minQueryOverlap,
        excludeTypes: memoryPolicy.excludeTypes ?? [],
        autoRecallAllowed: false,
        fallbackReason: this.turnInference?.fallbackReason,
        exploratoryCreative: Boolean(this.turnInference?.exploratoryCreative),
      });
    }

    let messages = await this.context.buildMessages();
    // ── Adaptive intent routing ───────────────────────────────────────────────
    // Cache the routing profile for the duration of this turn. Intent/model/maxTokens
    // are stable across rounds — rebuilding every round is wasteful and causes
    // repeated routing-line noise in the UI. Tool filter is included in the cache;
    // if lazy tool loading adds new tools, they bypass the filter because coding/
    // execution intents carry toolFilter=null and heuristic classifications never
    // activate filters (applyToolFilter requires source==="llm" + high confidence).
    if (!this._turnRoutingProfile) {
      this._turnRoutingProfile = buildRoutingProfile(
        this.turnInference ?? null,
        this.config.model
      );
    }
    const routingProfile: RoutingProfile = this._turnRoutingProfile;
    // Emit the routing line only on round 0 — intent and model are fixed for the
    // entire turn. Include source + confidence so the trace is actionable, not just
    // a restatement of the model slug.
    if (routingProfile.applied && round === 0 && !this.sessionGreetingThisSend && !this.personaBootstrapPromptThisSend) {
      const srcNote =
        routingProfile.source !== "default" && routingProfile.confidence > 0
          ? ` src=${routingProfile.source}(${Math.round(routingProfile.confidence * 100)}%)`
          : "";
      const filterNote = routingProfile.toolFilterActive ? ` tools=filtered` : "";
      this.emitter.emit("text", {
        delta: `[routing: intent=${routingProfile.intent}${srcNote} model=${routingProfile.modelSlug} maxTokens=${routingProfile.maxTokens}${filterNote}]\n`,
        channel: "trace",
      });
      if (this._turnReasoningBudget) {
        this.emitter.emit("text", {
          delta: formatReasoningBudgetTraceLine(this._turnReasoningBudget, this._turnReasoningSurface),
          channel: "trace",
        });
      }
    }
    const tools =
      this.sessionGreetingThisSend || this.personaBootstrapPromptThisSend
        ? []
        : this.registry.toOpenAIFormat(routingProfile.toolFilter ?? undefined);
    const accumulator = new StreamAccumulator();
    // PASTE: speculative tool dispatch — start safe tool calls while stream is still running.
    const pasteEnabled = resolveHarnessEnvRaw("AGENT_PASTE", this.runtimePreferences) === "1";
    const speculativePromises = new Map<string, Promise<ToolResult>>();

    const chunkTimeoutMs = Math.max(
      10_000,
      parseInt(
        resolveHarnessEnvRaw("AGENT_STREAM_CHUNK_TIMEOUT_MS", this.runtimePreferences) ?? "60000",
        10
      ) || 60_000
    );
    const maxStreamRetries = Math.max(
      0,
      parseInt(resolveHarnessEnvRaw("AGENT_STREAM_MAX_RETRIES", this.runtimePreferences) ?? "3", 10) || 3
    );

    const routingModel = routingProfile.applied ? routingProfile.modelSlug : undefined;
    let streamAbort = new AbortController();
    let stream = await this.streamWithRetry(
      messages,
      tools,
      routingModel,
      this._turnReasoningBudget,
      streamAbort,
      this._turnReasoningSurface
    );
    let finishReason: string | null = null;
    let streamAttempt = 0;

    streamLoop: while (true) {
      try {
        const streamChunkTimeoutMs = () => {
          if (this.fileWriteStreamSink?.hasActiveIngest()) {
            return Math.max(chunkTimeoutMs * 4, 180_000);
          }
          return chunkTimeoutMs;
        };
        for await (const chunk of withChunkTimeout(stream, streamChunkTimeoutMs)) {
          // Check abort between chunks
          if (this.abortSignal?.aborted) return;

          const parsed = accumulator.processChunk(chunk);

          if (parsed.textDelta) {
            if (hasPseudoToolMarkup(parsed.textDelta)) {
              this.pseudoMarkupSuppressCountThisSend += 1;
              if (!this.pseudoMarkupSuppressionNotifiedThisSend) {
                this.pseudoMarkupSuppressionNotifiedThisSend = true;
                this.emitter.emit("text", {
                  delta:
                    "\n[HARNESS] Suppressing pseudo tool markup from streamed assistant text (aggregating further matches).\n",
                  channel: "trace",
                });
              }
            } else {
              this.emitter.emit("text", { delta: parsed.textDelta, channel: "user" });
            }
          }

          if (parsed.reasoningDelta && this._turnReasoningSurface === "native") {
            this.emitter.emit("text", { delta: parsed.reasoningDelta, channel: "reasoning" });
          }

          if (parsed.toolCallDelta) {
            const { index, id, name, argsDelta } = parsed.toolCallDelta;
            if (id && name) {
              this.streamingToolNamesByCallId.set(id, name);
            }
            const streamToolName =
              name ?? (id ? this.streamingToolNamesByCallId.get(id) : undefined);
            if (parsed.isNewTool && id && name) {
              this.emitter.emit("tool_start", {
                callId: id,
                name,
                traceId: this.currentTurnTraceId,
                roundIndex: this.roundCount,
              });
              if (this.fileWriteStreamSink && isFileWriteToolName(name)) {
                this.fileWriteStreamSink.open(id, name);
              }

              // PASTE: when the model starts streaming a new tool call (index N),
              // tool call N-1's args are complete. Speculatively dispatch if safe.
              if (pasteEnabled && index > 0) {
                this.maybeStartEagerDispatch(accumulator, index - 1, speculativePromises, pasteEnabled);
              }
            }

            if (argsDelta) {
              const tc = accumulator.accumulatedToolCalls[index];
              if (tc) {
                this.emitter.emit("tool_delta", { callId: tc.id, argsDelta });
                if (this.fileWriteStreamSink && isFileWriteToolName(tc.name)) {
                  await this.fileWriteStreamSink.ingestDelta(tc.id, tc.name, argsDelta);
                }
                this.maybeStartEagerDispatch(accumulator, index, speculativePromises, pasteEnabled);
              }
            }
          }

          if (parsed.finishReason) {
            finishReason = parsed.finishReason;
          }
        }
        // Surface prompt-cache hit rate so we can verify caching is firing.
        // Quiet under AGENT_UI_VERBOSITY=quiet; trace channel either way.
        try {
          const usage = accumulator.usage as
            | { prompt_tokens?: number }
            | null
            | undefined;
          if (usage && typeof usage === "object") {
            const cached = extractCachedTokens(usage);
            const prompt = (usage.prompt_tokens ?? 0) as number;
            if (prompt > 0) {
              const pct = prompt > 0 ? Math.round((cached / prompt) * 100) : 0;
              this.emitter.emit("text", {
                delta: `[HARNESS] prompt_cache: cached=${cached}/${prompt} (${pct}%)\n`,
                channel: "trace",
              });
            }
          }
        } catch {
          /* non-fatal */
        }
        break streamLoop; // stream completed successfully
      } catch (streamErr) {
        // Never retry if the task was externally cancelled
        if (this.abortSignal?.aborted) return;

        const streamErrMsg = describeError(streamErr);
        const isChunkTimeout = streamErrMsg.includes("STREAM_CHUNK_TIMEOUT");
        const canRetry =
          streamAttempt < maxStreamRetries && (isChunkTimeout || isRetryable(streamErr));

        if (!canRetry) throw streamErr;

        streamAttempt++;
        const interruptedText = accumulator.accumulatedText;
        const interruptedToolCalls = [...accumulator.accumulatedToolCalls];
        const hadPartialContent =
          interruptedText.length > 0 || interruptedToolCalls.length > 0;

        accumulator.reset();
        speculativePromises.clear(); // discard PASTE results from failed stream attempt
        finishReason = null;

        const retryLabel = isChunkTimeout
          ? `stream stalled (${Math.round(chunkTimeoutMs / 1000)}s without data)`
          : "stream connection reset";

        if (hadPartialContent && !this.isUiQuiet()) {
          this.emitter.emit("text", {
            delta: `\n\n[⟳ ${retryLabel} — restarting stream (attempt ${streamAttempt}/${maxStreamRetries})…]\n\n`,
            channel: "user",
          });
        }

        if (interruptedToolCalls.length > 0) {
          for (const tc of interruptedToolCalls) {
            if (!isFileWriteToolName(tc.name)) continue;
            speculativePromises.delete(tc.id);
          }
          await this.commitInterruptedStreamAttempt(
            interruptedText,
            interruptedToolCalls,
            retryLabel,
            speculativePromises
          );
          messages = await this.context.buildMessages();
        }

        this.emitter.emit("provider_retry", {
          attempt: streamAttempt,
          maxAttempts: maxStreamRetries + 1,
          message: retryLabel,
          backoffMs: Math.min(2000 * streamAttempt, 10_000),
        });

        await sleep(Math.min(2000 * streamAttempt, 10_000));
        streamAbort = new AbortController();
        stream = await this.streamWithRetry(
          messages,
          tools,
          routingModel,
          this._turnReasoningBudget,
          streamAbort,
          this._turnReasoningSurface
        );
      }
    }

    for (let i = 0; i < accumulator.accumulatedToolCalls.length; i++) {
      this.maybeStartEagerDispatch(accumulator, i, speculativePromises, pasteEnabled);
    }

    const toolCalls = accumulator.accumulatedToolCalls;
    const accumulatedText = accumulator.accumulatedText;
    const assistantMessage = this.buildAssistantMessage(
      accumulatedText,
      toolCalls
    );

    const skipStreamContinuationsForIntro =
      toolCalls.length === 0 &&
      shouldSkipHarnessSecondaryPassesForTurn(this.lastUserMessage, this.turnInference);

    if (
      !skipStreamContinuationsForIntro &&
      toolCalls.length > 0 &&
      this.lengthResumeRemaining > 0 &&
      batchHasUndispatchableFileWrites(toolCalls, finishReason)
    ) {
      this.lengthResumeRemaining--;
      for (const tc of toolCalls) {
        if (!isFileWriteToolName(tc.name)) continue;
        speculativePromises.delete(tc.id);
        discardFileWriteStreamManifest(tc.id);
      }
      let resumeMsg = LENGTH_RESUME_FILE_WRITE_MESSAGE;
      if (this.fileWriteStreamSink) {
        for (const tc of toolCalls) {
          if (!isFileWriteToolName(tc.name)) continue;
          const salvaged = await this.fileWriteStreamSink.salvagePartialToTarget(tc.id);
          if (salvaged) {
            resumeMsg +=
              ` Saved ${salvaged.bytes} bytes to ${salvaged.targetPath} before cutoff — continue with write_file mode=append.`;
          } else {
            resumeMsg += this.fileWriteStreamSink.buildLengthResumeHint(tc.id);
          }
          this.fileWriteStreamSink.discard(tc.id);
        }
      }
      this.context.append(assistantMessage);
      this.context.appendMessage({
        role: "user",
        content: resumeMsg,
      });
      await this.runReActLoop(round);
      return;
    }

    if (
      !skipStreamContinuationsForIntro &&
      toolCalls.length === 0 &&
      this.pseudoToolMarkupRetryRemaining > 0 &&
      hasPseudoToolMarkup(accumulator.accumulatedText)
    ) {
      this.pseudoToolMarkupRetryRemaining--;
      this.context.appendMessage({
        role: "user",
        content:
          "[FORMAT RECOVERY] Your previous output included pseudo tool markup tags instead of real function calls. " +
          "Do not print XML/tool tags. If you need tools, emit proper tool calls only; otherwise provide normal assistant text.",
      });
      this.emitter.emit("text", {
        delta:
          "\n[HARNESS] Recovered from pseudo tool markup after retry/rate-limit path; requesting proper tool calls.\n",
        channel: "trace",
      });
      await this.runReActLoop(round + 1);
      return;
    }
    if (this.pseudoMarkupSuppressCountThisSend > 0) {
      this.emitter.emit("text", {
        delta:
          `\n[HARNESS] Pseudo-markup chunks suppressed this send: ${this.pseudoMarkupSuppressCountThisSend}.\n`,
        channel: "trace",
      });
      this.pseudoMarkupSuppressCountThisSend = 0;
    }

    this.context.append(assistantMessage);

    if (shouldDispatchToolBatch(toolCalls, finishReason)) {
      this.toolCallsDispatchedThisSend += toolCalls.length;
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

      // ── DAG-aware dispatch ───────────────────────────────────────────────────
      // dispatch_graph tool calls register dependency edges into _toolDag BEFORE
      // the regular calls are dispatched. Separate them so deps are populated first.
      const dagCallIndices: number[] = [];
      const regularCallIndices: number[] = [];
      for (let _di = 0; _di < toolCalls.length; _di++) {
        if (repIdx[_di] !== _di) continue;
        if (toolCalls[_di]!.name === "dispatch_graph") dagCallIndices.push(_di);
        else regularCallIndices.push(_di);
      }

      // Duplicate-call hints: identical tool+args already run earlier this turn.
      const duplicateHints: string[] = [];
      const dispatchAt = async (idx: number) => {
        const tc = toolCalls[idx]!;
        if (
          this.executionState &&
          resolveHarnessEnvRaw("AGENT_COMPENSATION_ENABLED", this.runtimePreferences) !== "0" &&
          (tc.name === "write_file" || tc.name === "edit_file")
        ) {
          try {
            const snapArgs = JSON.parse(tc.argsJson) as Record<string, unknown>;
            const filePath = String(snapArgs["path"] ?? "").trim();
            const mode = snapArgs["mode"];
            const needsSnapshot =
              tc.name === "edit_file" ||
              mode === "overwrite" ||
              mode === "append";
            if (filePath && needsSnapshot) {
              const original = await snapshotFileForCompensation(filePath);
              if (original !== null) {
                const planId =
                  this.executionState.activeContractId ?? this.executionState.mission?.id;
                if (planId) {
                  recordCompensation(planId, this.roundCount, {
                    kind: "restore_file_content",
                    path: filePath,
                    originalContent: original,
                  });
                }
              }
            }
          } catch {
            /* non-fatal */
          }
        }
        // Loop-break: short-circuit any (tool, args) shape that has already
        // been banned this send because it failed 3+ times in a row. Returning
        // a synthetic failure here keeps the loop-detector message in context
        // without burning another round on the same broken call.
        const bannedShapeKey = `${tc.name}::${hashString(tc.argsJson || "")}`;
        let result: import("./types.js").ToolResult;
        if (this.bannedToolCallShapesThisSend.has(bannedShapeKey)) {
          result = {
            ok: false,
            error: `[loop_break] This (${tc.name}, args) combination was blocked after 3 consecutive failures earlier this turn. Try a different tool or change the arguments meaningfully.`,
          };
        } else {
          const runDispatch = async () => {
            const speculative = speculativePromises.get(tc.id);
            if (speculative) return speculative;
            const promoted = this.tryPromotePasteSpeculation(tc.name, tc.argsJson);
            if (promoted) return promoted;
            return this.dispatcher.dispatch(tc.id, tc.name, tc.argsJson, batchToolNames);
          };
          if (tc.name === "write_file" || tc.name === "edit_file") {
            const pathKey = this.fileWritePathKeyFromArgs(tc.argsJson);
            result = pathKey
              ? await this.runSerializedOnFileWritePath(pathKey, runDispatch)
              : await runDispatch();
          } else {
            result = await runDispatch();
          }
        }
        results[idx] = result;
        // Index output for query_tool_outputs + flag identical cross-round re-calls.
        const argsKey = tc.argsJson.slice(0, 200);
        const prior = this._sessionToolIndex.findPriorCall(tc.name, argsKey, tc.id);
        this._sessionToolIndex.add({
          callId: tc.id,
          toolName: tc.name,
          argsKey,
          output: result.ok ? String(result.output ?? "") : String(result.error ?? ""),
          at: new Date().toISOString(),
          ok: result.ok,
        });
        if (prior) {
          duplicateHints.push(
            `${tc.name} was already called with identical arguments earlier this turn (call ${prior.callId}).`
          );
        }
        this._toolOutcomesThisTurn.push({ name: tc.name, ok: result.ok });
      };

      // 1. Run dispatch_graph calls first so the DAG is populated.
      await Promise.all(dagCallIndices.map(dispatchAt));

      // 2. Execute remaining calls in topological order if DAG has edges.
      if (!this._toolDag.isEmpty() && regularCallIndices.length > 0) {
        const idToIdx = new Map<string, number>(
          regularCallIndices.map((i) => [toolCalls[i]!.id, i])
        );
        const callIds = regularCallIndices.map((i) => toolCalls[i]!.id);
        const batches = this._toolDag.topologicalBatches(callIds);
        const resultsByCallId = new Map<string, { ok: boolean; output: string; error?: string }>();
        for (const batchIds of batches) {
          for (const id of batchIds) {
            const idx = idToIdx.get(id)!;
            const tc = toolCalls[idx]!;
            try {
              const argsObj = JSON.parse(tc.argsJson) as Record<string, unknown>;
              const merged = this._toolDag.injectResolvedDeps(argsObj, id, resultsByCallId);
              toolCalls[idx] = { ...tc, argsJson: JSON.stringify(merged) };
            } catch {
              /* keep original args */
            }
          }
          await Promise.all(batchIds.map((id) => dispatchAt(idToIdx.get(id)!)));
          for (const id of batchIds) {
            const idx = idToIdx.get(id)!;
            const r = results[idx]!;
            resultsByCallId.set(id, {
              ok: r.ok,
              output: r.ok ? String(r.output ?? "") : "",
              error: r.ok ? undefined : r.error,
            });
          }
        }
      } else {
        await Promise.all(regularCallIndices.map(dispatchAt));
      }

      // Clear DAG for next round.
      this._toolDag.clear();

      // Push a duplicate-work signal so the model reuses earlier results
      // instead of re-running identical tool calls across rounds.
      if (duplicateHints.length > 0) {
        this.context.appendMessage({
          role: "system",
          content:
            "[DUPLICATE TOOL CALLS] " +
            duplicateHints.join(" ") +
            " Reuse the earlier result via query_tool_outputs instead of re-running identical calls.",
        });
      }

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
          traceId: this.currentTurnTraceId,
          roundIndex: this.roundCount,
        });
      }

      // Track tools used this turn (for recipe recording)
      for (const tc of toolCalls) {
        this.toolsUsedThisTurn.push(tc.name);
      }
      // PASTE: feed successful tool names into the pattern context window.
      for (let i = 0; i < toolCalls.length; i++) {
        if (results[i]?.ok) this._pasteRecentTools.push(toolCalls[i]!.name);
      }
      if (this._pasteRecentTools.length > 16) {
        this._pasteRecentTools = this._pasteRecentTools.slice(-16);
      }
      // Fire-and-forget — speculation runs concurrently with the next stream.
      void this.maybePredictiveSpeculate();
      this.lastParallelToolBatchSize = toolCalls.length;
      let awarenessNeedsRefresh = false;
      let awarenessReason = "";
      const changedPathsCountBeforeBatch = this.changedFilesThisTurn.size;

      for (let i = 0; i < toolCalls.length; i++) {
        const tc = toolCalls[i]!;
        const r = results[i]!;
        this.rememberChangedPathFromToolCall(tc.name, tc.argsJson, r.ok);
        // ── Compensation ledger — record undo action on success ────────────────
        if (r.ok && this.executionState) {
          const planId = this.executionState.activeContractId ?? this.executionState.mission?.id;
          if (planId) {
            try {
              const args = JSON.parse(tc.argsJson) as Record<string, unknown>;
              const action = inferCompensationAction(tc.name, args);
              if (action) recordCompensation(planId, this.roundCount, action);
            } catch { /* non-fatal */ }
          }
        }
        if (
          r.ok &&
          !this.writeIntegrityNudgeThisSend &&
          isFileWriteToolName(tc.name) &&
          resolveHarnessEnvRaw("AGENT_WRITE_INTEGRITY_NUDGE", this.runtimePreferences) !== "0" &&
          r.output.includes("likely_truncated=true")
        ) {
          this.writeIntegrityNudgeThisSend = true;
          this.context.appendMessage({
            role: "user",
            content:
              "[SYSTEM NOTE] The last file write may be incomplete (likely_truncated). " +
              "Continue with write_file mode=append before answering the user.",
          });
        }
        const line = `${tc.name}:${r.ok ? "ok" : "fail"}`;
        this.recentToolOutcomeLines.push(line.slice(0, 160));
        if (this.recentToolOutcomeLines.length > 3) this.recentToolOutcomeLines.shift();

        // ── Loop detection ──────────────────────────────────────────────────
        // When the same (tool_name, normalized_args) call fails 3+ times in a
        // row, the model has clearly mis-mapped the situation onto the wrong
        // tool (classic: calling read_file on a directory path repeatedly when
        // list_dir is what's needed). Ban the shape for the rest of this send
        // and inject a corrective system message naming the wrong tool.
        const argsHash = hashString(tc.argsJson || "");
        const shapeKey = `${tc.name}::${argsHash}`;
        if (!r.ok) {
          if (
            this.toolCallStreak &&
            this.toolCallStreak.name === tc.name &&
            this.toolCallStreak.argsHash === argsHash
          ) {
            this.toolCallStreak.failures += 1;
          } else {
            this.toolCallStreak = { name: tc.name, argsHash, failures: 1 };
          }
          if (this.toolCallStreak.failures >= 3 && !this.bannedToolCallShapesThisSend.has(shapeKey)) {
            this.bannedToolCallShapesThisSend.add(shapeKey);
            const argsPreview = tc.argsJson.slice(0, 200);
            const errSnippet = r.error ? r.error.slice(0, 240) : "(no error)";
            // Try to infer a suggested alternative based on the error pattern.
            const suggestion = inferLoopBreakSuggestion(tc.name, errSnippet);
            this.context.appendMessage({
              role: "user",
              content:
                `[LOOP DETECTED] You called \`${tc.name}\` with the same args ${this.toolCallStreak.failures} times in a row and each call failed with: ${errSnippet}\n\n` +
                `Args (preview): ${argsPreview}\n\n` +
                (suggestion
                  ? `Try a different tool. Specifically: ${suggestion}\n\n`
                  : "Stop calling this exact tool+args combination. Pick a different tool or change the arguments meaningfully.\n\n") +
                `This (tool, args) shape is now blocked for the rest of this turn — further identical calls will be rejected without dispatch.`,
            });
            this.loopBreakNudgeFiredThisSend = true;
            this.emitter.emit("recovery_action", {
              strategy: "replan",
              reason: `loop_break:${tc.name} ${this.toolCallStreak.failures}x — ${errSnippet.slice(0, 120)}`,
            });
          }
        } else {
          // Any successful call resets the streak — model is making progress.
          this.toolCallStreak = null;
        }
        if (r.ok && tc.name === "read_file") {
          try {
            const a = JSON.parse(tc.argsJson) as { path?: string; offset?: number; limit?: number };
            if (a.path) {
              this.filesReadThisTurn.push(a.path);
              if (this.filesReadThisTurn.length > 24) this.filesReadThisTurn.shift();
              const key = a.path.replace(/\\/g, "/").toLowerCase();
              // Count by path regardless of offset/limit — re-reads with different
              // slices on the same file are the most common stall pattern when
              // distillation is on or context has rolled over.
              const nextCount = (this.readFilePathCountsThisTurn.get(key) ?? 0) + 1;
              this.readFilePathCountsThisTurn.set(key, nextCount);
              if (nextCount === 2) {
                const ext = key.split(".").pop() ?? "";
                const browserRelevant = ["html", "htm", "js", "jsx", "ts", "tsx", "css"].includes(ext);
                this.context.appendMessage({
                  role: "user",
                  content:
                    "[SYSTEM NOTE] Repeated full read_file on the same path detected. Avoid looping on full-file reads. " +
                    "Use targeted checks instead: read_file_chunked for large files, file_metadata/workspace_snapshot for integrity, " +
                    "run_lint/run_tests for static verification, and browser_open/browser_act(include_console=true) for browser runtime errors " +
                    (browserRelevant ? "on this frontend file." : "when reviewing web behavior."),
                });
              } else if (nextCount === 4) {
                // Hard stop: the model is in a re-read loop. Surface the prior
                // round indices so it can scroll back instead of looping.
                this.context.appendMessage({
                  role: "user",
                  content:
                    `[SYSTEM NOTE] read_file on "${a.path}" has now been called ${nextCount}× this turn. ` +
                    `The content from earlier reads is still in your conversation history above — scroll back rather than re-reading. ` +
                    `If you cannot see it, call compress_context() once to consolidate and continue with what you remember; ` +
                    `do not call read_file on this path again this turn.`,
                });
              }
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
              // ResearchLedger: parse URLs out of the result body and record
              // them as pending. Multidomain — purely behavioral.
              this._researchLedger.recordSearch(
                q,
                r.ok ? String(r.output ?? "") : "",
                r.ok
              );
            }
          } catch {
            /* ignore */
          }
        } else if (tc.name === "web_fetch" || tc.name === "http_request") {
          try {
            const a = JSON.parse(tc.argsJson) as { url?: string };
            if (typeof a.url === "string" && a.url.trim().length >= 4) {
              const url = a.url.trim();
              let fetchOk = r.ok;
              let fetchBody = r.ok ? String(r.output ?? "") : undefined;
              let fetchErr = r.ok ? undefined : String(r.error ?? "");
              if (tc.name === "http_request" && r.ok && fetchBody) {
                try {
                  const parsed = JSON.parse(fetchBody) as {
                    ok?: boolean;
                    skipped?: boolean;
                    error?: string;
                    guidance?: string;
                  };
                  if (parsed.skipped || parsed.ok === false) {
                    fetchOk = false;
                    fetchErr = parsed.error ?? parsed.guidance ?? "http_request failed or skipped";
                  }
                } catch {
                  /* plain text body */
                }
              }
              this._researchLedger.recordFetch(url, fetchOk, fetchOk ? fetchBody : undefined, fetchErr);
            }
          } catch {
            /* ignore */
          }
        }
        if (tc.name === "think" && r.ok) {
          // Pre-activate any tool families declared in structured think() calls.
          try {
            const targs = JSON.parse(tc.argsJson) as { tool_families?: string[] };
            const families = targs.tool_families;
            if (Array.isArray(families) && families.length > 0 && this.registry.isLazyToolLoading()) {
              const newly = this.registry.activateFamilies(families);
              if (newly.length > 0) {
                awarenessNeedsRefresh = true;
                awarenessReason = "think_family_preseed";
                this.emitter.emit("text", {
                  channel: "trace",
                  delta: `[think] pre-activated families: ${families.join(", ")} → ${newly.length} new tool(s)\n`,
                });
              }
            }
          } catch {
            // malformed args — ignore, execution continues normally
          }
        }
        if (tc.name === "breakdown" && r.ok) {
          try {
            const bargs = JSON.parse(tc.argsJson) as {
              tool_families?: string[];
              clarification_needed?: boolean;
              clarification_question?: string;
              unknowns?: string[];
            };
            const families = bargs.tool_families;
            if (Array.isArray(families) && families.length > 0 && this.registry.isLazyToolLoading()) {
              const newly = this.registry.activateFamilies(families);
              if (newly.length > 0) {
                awarenessNeedsRefresh = true;
                awarenessReason = "breakdown_family_preseed";
                this.emitter.emit("text", {
                  channel: "trace",
                  delta: `[breakdown] pre-activated families: ${families.join(", ")} → ${newly.length} new tool(s)\n`,
                });
              }
            }
            if (bargs.clarification_needed && bargs.clarification_question?.trim()) {
              this.breakdownClarificationGate = bargs.clarification_question.trim();
              if (this.executionState) {
                const unknowns = Array.isArray(bargs.unknowns) ? bargs.unknowns : [];
                this.executionState = {
                  ...this.executionState,
                  unresolvedQuestions: [
                    ...this.executionState.unresolvedQuestions,
                    bargs.clarification_question.trim(),
                    ...unknowns.slice(0, 3),
                  ].slice(0, 8),
                };
                this.syncExecutionStateToContext();
              }
              this.context.appendMessage({
                role: "user",
                content:
                  `[CLARIFICATION REQUIRED] ${bargs.clarification_question.trim()} ` +
                  "Call ask_user with this question before any mutating or side-effecting tools.",
              });
            }
          } catch {
            /* ignore malformed breakdown args */
          }
        }
        if (tc.name === "ask_user" && r.ok) {
          this.breakdownClarificationGate = null;
        }
        if (tc.name === "activate_tool_family" && r.ok) {
          awarenessNeedsRefresh = true;
          awarenessReason = "family_activation_success";
        } else if (!r.ok && /not loaded for this session/i.test(r.error)) {
          awarenessNeedsRefresh = true;
          awarenessReason = "inactive_tool_error";
          this.context.appendMessage({
            role: "user",
            content:
              "[SYSTEM NOTE] A requested tool is inactive. Reconcile tool state now: call list_tool_families, activate one best-fit family, then retry with updated args.",
          });
        }
      }
      if (this.changedFilesThisTurn.size > changedPathsCountBeforeBatch) {
        this.dispatcher.invalidateCachesAfterFileWrites();
      }
      if (awarenessNeedsRefresh) this.refreshToolAwareness(awarenessReason);

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
                  this.syncExecutionStateToContext();
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
          `SPAWN_AGENT CALLS THIS SEND: ${this.toolsUsedThisTurn.filter((n) => n === "spawn_agent").length}\n` +
          `${buildToolAwarenessSnapshot(this.registry, this.toolsUsedThisTurn)}`;
        const modifiedSorted = [...this.changedFilesThisTurn].sort((a, b) =>
          a.localeCompare(b, undefined, { sensitivity: "base" })
        );
        this.context.patchEpistemicState({
          goal:
            this.lastUserMessage.slice(0, 500) +
            (this.lastUserMessage.length > 500 ? "…" : ""),
          filesTouched: [...this.filesReadThisTurn],
          filesModified: modifiedSorted,
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
        if (
          tc.name === "read_file" &&
          !this.largeReadPivotNudgeThisSend &&
          /…\s*\d+\s+more\s+lines/i.test(content)
        ) {
          this.largeReadPivotNudgeThisSend = true;
          this.context.appendMessage({
            role: "user",
            content:
              "[SYSTEM NOTE] Large file read was truncated/distilled. Do NOT call full read_file again on the same path. " +
              "Switch to targeted access: read_file_chunked, read_file with offset/limit, or file_metadata for integrity checks. " +
              "If this file was just created with write_file and already verified on disk, one targeted slice is enough—reply to the user (R-WRITE-ONE-VERIFY). " +
              "For typed project code in a repo, run_lint/run_tests may still apply (R-TYPECHECK-VERIFY); skip ad-hoc shell parsers for static HTML/JS demos unless the user asked.",
          });
        }
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
          void this.maybePlaybackCompensation("all tools failed in round");
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

        // Reflexion auto-persist: semantic lesson extraction via fast model, then remember().
        if (this.registry.has("remember")) {
          const reflectionKey = `reflection:${hashString(this.lastUserMessage).slice(0, 12)}`;
          let reflectionValue =
            `[Round ${this.roundCount}] All tools failed. ` +
            `Errors: ${errorSummary.slice(0, 200)}. ` +
            `Task: ${this.lastUserMessage.slice(0, 80)}`;
          // Semantic upgrade: ask fast model to extract a reusable lesson.
          if (resolveHarnessEnvRaw("AGENT_REFLEXION_SEMANTIC", this.runtimePreferences) !== "0") {
            try {
              const jr = await completeChatJson(this.client, {
                model: getFastModelSlug(this.config.model),
                temperature: 0,
                maxTokens: 220,
                messages: [
                  {
                    role: "system",
                    content:
                      "Diagnose this tool-failure round and extract a concise reusable lesson. " +
                      'Return JSON: {"lesson":"<max 200 chars>","root_cause":"<max 100 chars>","fix_pattern":"<max 100 chars>"}. ' +
                      "Be specific — name the tool that failed and why.",
                  },
                  {
                    role: "user",
                    content: `Task: ${this.lastUserMessage.slice(0, 300)}\nErrors: ${errorSummary.slice(0, 600)}`,
                  },
                ],
              });
              if (jr.ok && typeof jr.parsed === "object" && jr.parsed !== null) {
                const p = jr.parsed as { lesson?: string; root_cause?: string; fix_pattern?: string };
                if (p.lesson) {
                  reflectionValue =
                    `LESSON: ${p.lesson.slice(0, 200)} | ROOT: ${(p.root_cause ?? "").slice(0, 100)} | FIX: ${(p.fix_pattern ?? "").slice(0, 100)}`;
                }
              }
            } catch {
              /* keep fallback value */
            }
          }
          try {
            await this.dispatcher.directCall("remember", { key: reflectionKey, value: reflectionValue });
          } catch (err) {
            this.emitter.emit("text", {
              delta: `\n[HARNESS] Reflexion persist failed: ${err instanceof Error ? err.message : String(err)}\n`,
              channel: "trace",
            });
          }
        }
        // Track which rules were mentioned in the error context for effectiveness stats.
        void bumpRuleHits(errorSummary, true);

        // ACON adaptive compression: if a compression happened recently and we're now
        // seeing tool errors, the compression may have dropped needed context. Ask the
        // fast model to identify what to always preserve and persist it as a guideline.
        if (
          this.agentDepth === 0 &&
          !this.aconGuidelineAnalyzedThisSend &&
          this.lastCompressionTimestampThisSend > 0 &&
          Date.now() - this.lastCompressionTimestampThisSend < 120_000
        ) {
          this.aconGuidelineAnalyzedThisSend = true;
          void (async () => {
            try {
              const jr = await completeChatJson(this.client, {
                model: getFastModelSlug(this.config.model),
                temperature: 0,
                maxTokens: 180,
                messages: [
                  {
                    role: "system",
                    content:
                      "A context compression happened shortly before these tool errors. " +
                      "Identify one concrete piece of information that was likely lost and caused the error. " +
                      'Return JSON: {"preserve":"<one specific thing to always keep in future compressions, max 120 chars>","trigger":"<tool that failed>"}.',
                  },
                  {
                    role: "user",
                    content: `Task: ${this.lastUserMessage.slice(0, 200)}\nErrors: ${errorSummary.slice(0, 400)}`,
                  },
                ],
              });
              if (jr.ok && typeof jr.parsed === "object" && jr.parsed !== null) {
                const p = jr.parsed as { preserve?: string; trigger?: string };
                if (p.preserve && p.preserve.trim().length > 10) {
                  await addCompressionGuideline(p.preserve.trim(), p.trigger);
                }
              }
            } catch {
              /* non-fatal */
            }
          })();
        }
      }

      await this.runLintSelfHealIfNeeded();

      await this.runReActLoop(round + 1);
    } else if (toolCalls.length > 0) {
      await this.finalizeUndispatchedToolCalls(toolCalls, speculativePromises, finishReason);
      await this.runLintSelfHealIfNeeded();
      await this.runReActLoop(round + 1);
    } else {
      // Text-only completion: end the turn when the model stops (no post-assistant
      // critic, synthesis judge, cite guard, or stream [CONTINUE] loops).
      await this.maybePersistEpisodeTurn();
      await this.maybeAutoWriteVaultNotes();
      await this.maybeAutoExtractMemories();

      // Per-turn outcome score (used by summary + root-only learning paths).
      const turnOutcome = scoreTurnOutcome({
        toolsUsed: this._toolOutcomesThisTurn,
        roundCount: this.roundCount,
        criticPassed: this.criticConsumedThisSend ? true : null,
        contradictionCount: 0,
        terminationReason: "ok",
      });

      // Compact at-a-glance summary for UIs (emitted for every send before turn_end).
      const toolFreq = new Map<string, number>();
      for (const t of this.toolsUsedThisTurn) {
        toolFreq.set(t, (toolFreq.get(t) ?? 0) + 1);
      }
      const keyTools = [...toolFreq.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([n]) => n);
      const finalAnswer = this.context.getLastAssistantMessage() ?? "";
      const summaryPayload: TurnSummary = {
        intentClass: this.turnInference?.intent ?? "general",
        outcomeScore: turnOutcome,
        toolCount: this.toolsUsedThisTurn.length,
        roundCount: this.roundCount,
        durationMs: Date.now() - this.sendStartTime,
        finalAnswerPreview: finalAnswer.replace(/\s+/g, " ").trim().slice(0, 120),
        keyTools,
        terminationReason: "ok",
        ...(this.currentTurnTraceId ? { traceId: this.currentTurnTraceId } : {}),
      };
      this.emitter.emit("turn_summary", summaryPayload);

      // Causal trajectory memory + outcome-based learning (root agent only).
      if (this.agentDepth === 0) {
        void maybeWriteTrajectory({
          trigger: this.lastUserMessage,
          epistemicState: this.context.getEpistemicState(),
          toolsUsed: this._toolOutcomesThisTurn,
          roundCount: this.roundCount,
          intentClass: this.turnInference?.intent,
        }).catch(() => { /* non-fatal */ });

        // Rule effectiveness: attribute this turn's outcome to every rule injected.
        if (this.injectedRuleIdsThisSend.length > 0) {
          void recordRuleOutcomes(this.injectedRuleIdsThisSend, turnOutcome).catch(() => { /* non-fatal */ });
        }
        // Adaptive effort learning (AGENT_EFFORT_LEARN=1).
        const budget = this._turnReasoningBudget;
        if (budget) {
          void recordEffortOutcome(
            (this.turnInference?.intent ?? "knowledge") as ReasoningIntentClass,
            budget.reasoningEffort,
            turnOutcome
          ).catch(() => { /* non-fatal */ });
        }
      }

      this.emitTurnEnd("ok");
      if (!this.sessionGreetingThisSend && !this.personaBootstrapPromptThisSend) {
        this.triggerAutoDreamConsolidationBackground();
      }
    }
  }

  private async streamWithRetry(
    messages: Message[],
    tools: OpenAI.Chat.Completions.ChatCompletionTool[],
    modelOverride?: string,
    reasoningBudget?: ReasoningBudget | null,
    streamAbort?: AbortController,
    reasoningSurface: ReasoningSurface = "native"
  ): Promise<Stream<OpenAI.Chat.Completions.ChatCompletionChunk>> {
    let lastErr: unknown;
    const retryStartedAt = Date.now();

    // Toolless retries can produce plausible text claims without executing required tools.
    // Default to tools-on for all retries unless explicitly opted-in.
    const allowToollessRetry = this.config.allowToollessStreamRetry === true;
    let attempt = 0;
    while (true) {
      if (Date.now() < this.providerCircuitOpenUntilMs) {
        const sec = Math.ceil((this.providerCircuitOpenUntilMs - Date.now()) / 1000);
        throw new Error(`Provider circuit open due to repeated upstream failures. Retry in ~${sec}s.`);
      }
      const useTools =
        tools.length > 0 && (allowToollessRetry ? attempt < 2 : true);
      const useToolChoice = useTools && attempt === 0;

      // Effective max_tokens: routing profile per-intent allocation takes precedence
      // over the global AGENT_MAX_COMPLETION_TOKENS cap. This ensures that coding/
      // execution turns (8192/6144) aren't silently capped at the 4000-token default.
      const routingMaxTokens = this._turnRoutingProfile?.maxTokens ?? 0;
      const maxCompletionRaw = parseInt(
        resolveHarnessEnvRaw("AGENT_MAX_COMPLETION_TOKENS", this.runtimePreferences) ?? "0",
        10
      );
      const defaultMaxTokens = Number.isFinite(maxCompletionRaw) && maxCompletionRaw > 0
        ? maxCompletionRaw
        : 0;
      const effectiveMaxTokens = routingMaxTokens > 0 ? routingMaxTokens : defaultMaxTokens;
      const maxCompletionTokens = effectiveMaxTokens > 0
        ? Math.min(effectiveMaxTokens, 128_000)
        : undefined;

      // Provider pinning for OpenRouter cache affinity — without this, OpenRouter randomly
      // load-balances across providers and each has its own KV cache, so the system prompt
      // is re-ingested on every request. Pinning to a single provider keeps the cache warm.
      const providerRouting = buildProviderRouting(modelOverride ?? this.config.model);

      const reasoningParam =
        reasoningBudget != null
          ? buildOpenRouterReasoningParam(reasoningBudget, reasoningSurface)
          : {};

      // Prompt cache breakpoint: tag the trailing static system message with
      // `cache_control: { type: "ephemeral" }` so cache-supporting providers
      // (DeepInfra, GMICloud, NovitaAI, …) serve the prefix at ~1/10× cost on
      // every round after the first. No-op when AGENT_PROMPT_CACHE=0.
      const cachedMessages = applyPromptCacheBreakpoints(messages);

      const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming & {
        provider?: { order: string[]; allow_fallbacks: boolean };
        user?: string;
        reasoning?: { effort: string };
        stream_options?: { include_usage: boolean };
      } = {
        model: modelOverride ?? this.config.model,
        messages: cachedMessages,
        stream: true,
        // Request usage on the terminal chunk so we can log cache hit rate.
        stream_options: { include_usage: true },
        ...(maxCompletionTokens !== undefined && { max_tokens: maxCompletionTokens }),
        ...(useTools && { tools }),
        ...(useToolChoice && { tool_choice: "auto" as const }),
        // OpenRouter-specific: sticky provider routing + session affinity for cache hits
        ...(providerRouting && { provider: providerRouting }),
        ...reasoningParam,
        user: this.taskId,
      };

      try {
        // Pass abort signal as RequestOptions (second arg) so hung streams can be cancelled (#3)
        const mergedSignal = this.mergeStreamAbortSignals(streamAbort);
        const stream = (await withProviderRequestSpacing(
          { apiKey: this.config.openRouterApiKey, baseURL: this.config.baseURL },
          () =>
            this.client.chat.completions.create(
              params,
              ...(mergedSignal ? [{ signal: mergedSignal }] : [])
            )
        )) as Stream<OpenAI.Chat.Completions.ChatCompletionChunk>;
        this.consecutiveProviderFailures = 0;
        return stream;
      } catch (err) {
        lastErr = err;
        const msg = describeError(err);

        const rateLimited = isRateLimitError(err);
        const providerUnavailable = isProviderUnavailableError(err);
        const retryForever = isRetryForeverEnabled();
        const maxRetriesForError = rateLimited
          ? this.rateLimitMaxRetries
          : providerUnavailable
          ? this.transient5xxMaxRetries
          : this.maxRetries;
        const cappedOut = attempt >= maxRetriesForError;
        const wallExceeded = Date.now() - retryStartedAt >= this.retryWallTimeMs;
        if (!isRetryable(err) || (cappedOut && !retryForever) || wallExceeded) {
          if (wallExceeded) {
            throw new Error(
              `Provider retries exceeded wall-time budget (${Math.round(this.retryWallTimeMs / 1000)}s). ` +
                `Stopping to avoid stalled session; please retry shortly. Last error: ${msg}`
            );
          }
          throw new Error(msg);
        }

        const delay = this.computeRetryDelayMs(
          attempt,
          rateLimited ? "rate_limited" : providerUnavailable ? "provider_unavailable" : "normal",
          getRetryAfterMsFromError(err)
        );
        if (rateLimited || providerUnavailable) {
          this.consecutiveProviderFailures += 1;
          const minCap = Math.max(
            1,
            parseInt(resolveHarnessEnvRaw("AGENT_MIN_CONCURRENT_AGENTS", this.runtimePreferences) ?? "1", 10) || 1
          );
          this.spawnConcurrencyCap = Math.max(minCap, Math.floor(this.spawnConcurrencyCap / 2));
          const cooldown = Math.max(
            delay,
            parseInt(
              resolveHarnessEnvRaw("AGENT_CONCURRENCY_COOLDOWN_MS", this.runtimePreferences) ?? "45000",
              10
            ) || 45_000
          );
          this.providerDegradedUntilMs = Date.now() + cooldown;
          if (this.consecutiveProviderFailures >= this.providerCircuitFailureThreshold) {
            this.providerCircuitOpenUntilMs = Date.now() + this.providerCircuitCooldownMs;
            throw new Error(
              `Provider circuit opened after ${this.consecutiveProviderFailures} consecutive upstream failures. ` +
                `Cooldown ${Math.round(this.providerCircuitCooldownMs / 1000)}s before retry.`
            );
          }
        } else {
          this.consecutiveProviderFailures = 0;
        }
        this.emitter.emit("provider_retry", {
          attempt: attempt + 1,
          maxAttempts: retryForever ? 0 : maxRetriesForError + 1,
          message: msg,
          backoffMs: delay,
        });
        if (!this.isUiQuiet()) {
          this.emitter.emit("text", {
            delta:
              `\n⟳ ${msg} — retrying in ${Math.round(delay / 1000)}s ` +
              `(attempt ${attempt + 1}/${retryForever ? "∞" : maxRetriesForError + 1})…\n`,
          });
        }

        await sleep(delay);
        attempt += 1;
      }
    }

    throw new Error(describeError(lastErr));
  }

  /**
   * Dispatch a tool as soon as streamed args form valid JSON (file writes by default).
   * Freezes further arg deltas for that index so trailing stream junk cannot corrupt args.
   */
  private maybeStartEagerDispatch(
    accumulator: StreamAccumulator,
    index: number,
    speculativePromises: Map<string, Promise<ToolResult>>,
    pasteEnabled: boolean
  ): void {
    if (accumulator.isToolCallIndexFrozen(index)) return;
    const completed = accumulator.tryGetCompletedCall(index);
    if (!completed || speculativePromises.has(completed.id)) return;

    const toolDef = this.registry.get(completed.name);
    if (!toolDef || !this.registry.isActive(completed.name)) return;
    if (!shouldEagerDispatchWhenArgsComplete(completed.name, toolDef, pasteEnabled)) return;

    accumulator.freezeToolCallIndex(index);
    speculativePromises.set(
      completed.id,
      this.dispatcher.dispatch(completed.id, completed.name, completed.argsJson, [])
    );
  }

  // ── PASTE predictive speculation ─────────────────────────────────────────────

  /**
   * Returns the lazily-instantiated PASTE scheduler when AGENT_PASTE_PREDICTIVE=1.
   * Returns null when the feature is disabled so all integration becomes a no-op.
   */
  private getPasteScheduler(): PasteScheduler | null {
    if (resolveHarnessEnvRaw("AGENT_PASTE_PREDICTIVE", this.runtimePreferences) !== "1") {
      return null;
    }
    if (!this._pasteScheduler) {
      const budgetMs = parseInt(
        resolveHarnessEnvRaw("AGENT_PASTE_BUDGET_MS", this.runtimePreferences) ?? "2000",
        10
      ) || 2000;
      const minProbRaw = resolveHarnessEnvRaw("AGENT_PASTE_MIN_PROB", this.runtimePreferences);
      const minProb = minProbRaw ? parseFloat(minProbRaw) : 0.5;
      const maxConcurrent = parseInt(
        resolveHarnessEnvRaw("AGENT_PASTE_MAX_CONCURRENT", this.runtimePreferences) ?? "2",
        10
      ) || 2;
      this._pasteScheduler = new PasteScheduler({ budgetMs, minProbability: minProb, maxConcurrent });
    }
    return this._pasteScheduler;
  }

  /**
   * Called after a tool batch settles. Queries the pattern store for likely
   * next tools, infers args from session tool index when possible, and starts
   * speculative dispatches that may be promoted by the model's next call.
   */
  private async maybePredictiveSpeculate(): Promise<void> {
    const scheduler = this.getPasteScheduler();
    if (!scheduler) return;
    if (this._pasteRecentTools.length === 0) return;
    const window = Math.max(
      1,
      parseInt(resolveHarnessEnvRaw("AGENT_PASTE_CONTEXT_WINDOW", this.runtimePreferences) ?? "2", 10) || 2
    );
    let predictions;
    try {
      predictions = await predictNextTools(this._pasteRecentTools, {
        window,
        topK: 3,
        minProbability: 0,
      });
    } catch {
      return;
    }
    if (predictions.length === 0) return;
    for (const p of predictions) {
      if (!scheduler.hasBudget()) break;
      const toolDef = this.registry.get(p.nextTool);
      if (!toolDef || !this.registry.isActive(p.nextTool)) continue;
      const candidate = {
        toolName: p.nextTool,
        args: {} as Record<string, unknown>,
        probability: p.probability,
        estimatedLatencyMs: 0,
      };
      if (!scheduler.isEligible(candidate, toolDef)) continue;
      const inferred = inferSpeculationArgs(p.nextTool, this._sessionToolIndex);
      if (!inferred) continue;
      candidate.args = inferred.args;
      const argsJson = JSON.stringify(inferred.args);
      const argsKey = stableArgsJsonKey(argsJson);
      const dedupe = `${p.nextTool}::${argsKey}`;
      if (this._pasteSpeculatedKeys.has(dedupe)) continue;
      this._pasteSpeculatedKeys.add(dedupe);
      const callId = `paste_spec_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
      scheduler.start(candidate, argsKey, () =>
        this.dispatcher.dispatch(callId, p.nextTool, argsJson, [])
      );
      this.emitter.emit("text", {
        delta: `[PASTE] speculating ${p.nextTool}(${inferred.source}) p=${p.probability.toFixed(2)}\n`,
        channel: "trace",
      });
    }
  }

  /**
   * Try to promote an in-flight predictive speculation matching this tool call.
   * Returns the promoted result promise on hit, or null when no match — caller
   * must then dispatch normally.
   */
  private tryPromotePasteSpeculation(
    toolName: string,
    argsJson: string
  ): Promise<ToolResult> | null {
    const scheduler = this._pasteScheduler;
    if (!scheduler) return null;
    const argsKey = stableArgsJsonKey(argsJson);
    return scheduler.promote(toolName, argsKey);
  }

  /**
   * Emit tool_result + context for tool calls that could not enter the normal dispatch batch.
   */
  private async finalizeUndispatchedToolCalls(
    toolCalls: AccumulatedToolCall[],
    speculativePromises: Map<string, Promise<ToolResult>>,
    finishReason: string | null
  ): Promise<void> {
    const reason =
      finishReason === "length"
        ? "tool arguments were truncated (length limit) and could not be executed"
        : "tool arguments were incomplete or invalid and could not be executed";

    for (const tc of toolCalls) {
      const pending = speculativePromises.get(tc.id);
      let result: ToolResult;
      if (pending) {
        result = await pending;
      } else if (tryParseToolArgs(tc.argsJson).ok) {
        result = {
          ok: false,
          error: `Tool "${tc.name}" was not dispatched: ${reason}.`,
        };
      } else {
        result = {
          ok: false,
          error: `Tool "${tc.name}": ${reason}.`,
        };
      }

      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.argsJson || "{}") as Record<string, unknown>;
      } catch {
        /* ignore */
      }

      if (!pending) {
        this.emitter.emit("tool_result", {
          callId: tc.id,
          name: tc.name,
          args,
          result,
          traceId: this.currentTurnTraceId,
          roundIndex: this.roundCount,
        });
      }

      const content = result.ok ? result.output : `ERROR: ${result.error}`;
      this.context.append({
        role: "tool",
        tool_call_id: tc.id,
        content,
      });
      this.toolsUsedThisTurn.push(tc.name);
      this.rememberChangedPathFromToolCall(tc.name, tc.argsJson, result.ok);
    }

    this.context.appendMessage({
      role: "user",
      content:
        `[SYSTEM NOTE] ${toolCalls.length} tool call(s) could not run: ${reason}. ` +
        "For large files use write_file mode=create once, then mode=append. Continue from the errors above.",
    });
  }

  /**
   * When a provider stream stalls mid-tool-call, commit partial assistant + tool
   * messages so the model does not blindly re-issue write_file on the same path.
   */
  private fileWritePathKeyFromArgs(argsJson: string): string | null {
    const parsed = tryParseToolArgs(argsJson);
    if (!parsed.ok) return null;
    const p = String(parsed.args["path"] ?? "").trim();
    return p || null;
  }

  private async runSerializedOnFileWritePath<T>(
    pathKey: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const prev = this.fileWritePathTail.get(pathKey) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = prev.then(() => gate);
    this.fileWritePathTail.set(pathKey, tail);
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (this.fileWritePathTail.get(pathKey) === tail) {
        this.fileWritePathTail.delete(pathKey);
      }
    }
  }

  private async commitInterruptedStreamAttempt(
    interruptedText: string,
    interruptedToolCalls: AccumulatedToolCall[],
    retryLabel: string,
    speculativePromises: Map<string, Promise<ToolResult>>
  ): Promise<void> {
    const toolCalls = interruptedToolCalls;
    if (toolCalls.length === 0) return;

    const assistantMessage = this.buildAssistantMessage(interruptedText, toolCalls);
    this.context.append(assistantMessage);

    const batchToolNames = toolCalls.map((tc) => tc.name);
    let anyFileWriteOk = false;

    for (const tc of toolCalls) {
      const parsed = tryParseToolArgs(tc.argsJson);
      let result: ToolResult;
      if (isFileWriteToolName(tc.name) && !fileWriteSafeToDispatch(tc, "length")) {
        let extra = "";
        if (this.fileWriteStreamSink) {
          const salvaged = await this.fileWriteStreamSink.salvagePartialToTarget(tc.id);
          if (salvaged) {
            extra =
              ` Partial progress (${salvaged.bytes} bytes) saved to ${salvaged.targetPath} — continue with write_file mode=append after the stream restarts.`;
          } else {
            extra = this.fileWriteStreamSink.buildLengthResumeHint(tc.id);
          }
          this.fileWriteStreamSink.discard(tc.id);
        }
        discardFileWriteStreamManifest(tc.id);
        result = {
          ok: false,
          error:
            `Stream interrupted (${retryLabel}): write_file was not committed (incomplete or truncated args).${extra}`,
        };
      } else if (parsed.ok) {
        const speculative = speculativePromises.get(tc.id);
        const runDispatch = async () =>
          speculative
            ? speculative
            : this.dispatcher.dispatch(tc.id, tc.name, tc.argsJson, batchToolNames);
        if (tc.name === "write_file" || tc.name === "edit_file") {
          const pathKey = this.fileWritePathKeyFromArgs(tc.argsJson);
          result = pathKey
            ? await this.runSerializedOnFileWritePath(pathKey, runDispatch)
            : await runDispatch();
        } else {
          result = await runDispatch();
        }
      } else {
        if (isFileWriteToolName(tc.name)) {
          this.fileWriteStreamSink?.discard(tc.id);
          discardFileWriteStreamManifest(tc.id);
        }
        result = {
          ok: false,
          error:
            `Stream interrupted (${retryLabel}): tool arguments were incomplete and were not executed.`,
        };
      }

      if (result.ok && isFileWriteToolName(tc.name)) anyFileWriteOk = true;

      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.argsJson || "{}") as Record<string, unknown>;
      } catch {
        /* ignore */
      }
      this.emitter.emit("tool_result", {
        callId: tc.id,
        name: tc.name,
        args,
        result,
        traceId: this.currentTurnTraceId,
        roundIndex: this.roundCount,
      });

      const content = result.ok ? result.output : `ERROR: ${result.error}`;
      this.context.append({
        role: "tool",
        tool_call_id: tc.id,
        content,
      });
      this.toolsUsedThisTurn.push(tc.name);
      this.rememberChangedPathFromToolCall(tc.name, tc.argsJson, result.ok);
    }

    const nudge = anyFileWriteOk
      ? "If write_file succeeded above, continue with write_file mode=append on the same path for the next section."
      : "Continue the task from the tool results above.";
    this.context.appendMessage({
      role: "user",
      content: `[STREAM RETRY] Provider ${retryLabel}. ${nudge}`,
    });
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
    this.clearPersonalityHeartbeatSchedule();
    this.personalityHeartbeatNudgeTimestampsMs = [];
    this.context.clear();
    this.roundCount = 0;
    this.persistedHypotheses = [];
    this.worldContextInjected = false;
    this.sessionGreetingSentThisHarness = false;
    this.personaBootstrapPromptSentThisHarness = false;
  }
}
