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
import { resolveProviderConfig } from "./provider_config.js";
import type { RuntimePreferences } from "./runtime_prefs.js";
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
import {
  inferTurnInference,
  resolveMemoryPolicy,
  evaluateOverInferenceSemantics,
  isIdentityRecallLikePrompt,
  type TurnInferenceResult,
} from "./intent_inference.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

/**
 * Wraps an async iterable so that each individual chunk must arrive within
 * `timeoutMs`. Throws STREAM_CHUNK_TIMEOUT if the provider stalls mid-stream.
 * The finally clause calls iter.return() to release the underlying connection.
 */
async function* withChunkTimeout<T>(
  stream: AsyncIterable<T>,
  timeoutMs: number
): AsyncGenerator<T> {
  const iter = stream[Symbol.asyncIterator]();
  try {
    while (true) {
      let timerId: ReturnType<typeof setTimeout> | undefined;
      const chunkPromise = iter.next();
      const timeoutPromise = new Promise<never>((_, reject) => {
        timerId = setTimeout(
          () =>
            reject(
              new Error(
                `STREAM_CHUNK_TIMEOUT: No data received for ${Math.round(timeoutMs / 1000)}s — ` +
                  "provider may be stalled. For very large files (thousands of lines), consider writing in sections to reduce per-completion size."
              )
            ),
          timeoutMs
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
  const raw = process.env["AGENT_INTENT_CONFIDENCE_MIN"]?.trim();
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
    if (typeof patch.runtime.vaultFirstStrict === "boolean") r.vaultFirstStrict = patch.runtime.vaultFirstStrict;
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
  return out;
}

function hasRuntimePreferenceChange(patch: Partial<RuntimePreferences>): boolean {
  return Boolean(
    (patch.provider && Object.keys(patch.provider).length > 0) ||
      (patch.runtime && Object.keys(patch.runtime).length > 0)
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
  const retryAfter = asAny?.headers?.["retry-after"];
  const raw = Array.isArray(retryAfter) ? retryAfter[0] : retryAfter;
  if (raw) {
    const secs = Number(raw);
    if (Number.isFinite(secs)) return Math.max(0, Math.round(secs * 1000));
    const ts = Date.parse(raw);
    if (Number.isFinite(ts)) return Math.max(0, ts - Date.now());
  }
  const msg = String(asAny?.message ?? describeError(err));
  const m = msg.match(/retry after\s+(\d+)\s*(ms|s|sec|seconds)?/i);
  if (!m) return null;
  const n = parseInt(m[1] ?? "0", 10);
  const unit = (m[2] ?? "s").toLowerCase();
  return unit.startsWith("ms") ? n : n * 1000;
}

function isRetryForeverEnabled(): boolean {
  return process.env["AGENT_RETRY_FOREVER"] === "1";
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
  // Require file/path-like context to avoid false positives like "Node.js".
  if (/packages[/\\]|[/\\]src[/\\]|[A-Za-z0-9_.-]+[/\\][A-Za-z0-9_.-]+\.(ts|tsx|js|jsx|json|md)\b/i.test(assistantText)) return true;
  if (/`[^`]{3,}\.(ts|tsx|js|json)`/.test(assistantText)) return true;
  return false;
}

function isSimpleIntrospectionPrompt(userMessage: string): boolean {
  const t = userMessage.toLowerCase();
  return (
    /\b(what model|which model|what harness|which harness|who are you|what are you running|what runtime)\b/.test(t) &&
    t.length < 220
  );
}

function hasUncertaintyMarkers(text: string): boolean {
  return /\b(might|may|seems|appears|possibly|tentative|uncertain|likely|could be|inference)\b/i.test(text);
}

function hasOverconfidentUserStanceClaims(text: string): boolean {
  const t = text.toLowerCase();
  return (
    /\b(you believe|you prefer|you are clearly|you definitely|you want|you support)\b/.test(t) &&
    !hasUncertaintyMarkers(t)
  );
}

function isOverInferenceGuardEnabled(): boolean {
  return process.env["AGENT_OVERINFERENCE_GUARD"] !== "0";
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

function isFreshnessSensitivePrompt(text: string): boolean {
  const t = text.toLowerCase();
  return /\b(latest|current|today|recent|update|version|release|release notes|changelog|what's new|state of)\b/.test(
    t
  );
}

function hasFreshnessClaims(text: string): boolean {
  const t = text.toLowerCase();
  return /\b(latest|current|as of|today|recent|version|release|updated)\b/.test(t);
}

function hasLiveNowClaims(text: string): boolean {
  const t = text.toLowerCase();
  return /\b(right now|live now|currently|at the moment|current conditions|happening now)\b/.test(t);
}

function isDeckIntentPrompt(text: string): boolean {
  const t = text.toLowerCase();
  return /\b(deck|powerpoint|pptx|ppx|slides|slide deck)\b/.test(t);
}

function isVisionCentricPrompt(text: string): boolean {
  const t = text.toLowerCase();
  return /\b(image|screenshot|photo|diagram|figure|ocr|read text from|what's in this picture|what is in this image|analyze this image)\b/.test(
    t
  );
}

function hasAsOfQualifier(text: string): boolean {
  return /\bas of\b|\bas-of\b|\bupdated\b|\blast updated\b/i.test(text);
}

function hasRecentYearEvidence(text: string): boolean {
  const currentYear = new Date().getFullYear();
  const years = [...text.matchAll(/\b(20\d{2})\b/g)].map((m) => parseInt(m[1]!, 10));
  return years.some((y) => y >= currentYear - 1);
}

function hasAuthoritativeSourceHint(text: string): boolean {
  const t = text.toLowerCase();
  return /(github\.com\/.+\/releases|docs\.|official|release notes|changelog|blog\.)/.test(t);
}

function hasWeatherFreshEvidence(text: string): boolean {
  const t = text.toLowerCase();
  return (
    (t.includes('"is_live": true') || t.includes("weather_lookup")) &&
    (t.includes('"observed_at"') || t.includes("as of"))
  );
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
    template: "For very large file generation (full applications, thousands of lines), break into sections using multiple write_file calls or use run_shell with a heredoc. Files up to ~1000 lines are fine in a single call; beyond that, generation time can exceed provider streaming limits.",
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
    write_file: "Confirm the parent directory exists with list_dir; use absolute paths. For very large files (full applications, >2000 lines), write in sections using multiple write_file calls or use run_shell with a heredoc — provider streaming timeouts can cut off completions that take many minutes to generate.",
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
  /** Count repeated full read_file calls per path in this send. */
  private readFilePathCountsThisTurn = new Map<string, number>();
  /** One-shot nudge when large read_file output is truncated/distilled. */
  private largeReadPivotNudgeThisSend = false;
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
  /** Retry budget when model emits pseudo tool markup instead of actual tool calls. */
  private pseudoToolMarkupRetryRemaining = 1;
  /** Count of suppressed pseudo-markup stream chunks this send (for compact trace). */
  private pseudoMarkupSuppressCountThisSend = 0;
  /** Emit suppression trace at most once per send to avoid spam. */
  private pseudoMarkupSuppressionNotifiedThisSend = false;
  /** One-shot nudge to cite a read path before turn_end(ok). */
  private finalizeCiteNudgeThisSend = false;
  /** One-shot nudge for research synthesis completeness before turn_end(ok). */
  private finalizeSynthesisNudgeThisSend = false;
  /** One-shot nudge for recency-sensitive prompts before turn_end(ok). */
  private finalizeRecencyNudgeThisSend = false;
  /** One-shot nudge for over-inference on user-stance readback. */
  private finalizeInferenceNudgeThisSend = false;
  /** One-shot guard for deck-intent requiring pptx render path. */
  private finalizeDeckPipelineNudgeThisSend = false;
  /** One-shot guard for vision-centric asks without sidecar usage. */
  private finalizeVisionNudgeThisSend = false;
  /** Max extra finalize replan loops allowed after a draft answer exists. */
  private finalizeRetryBudgetThisSend = 1;
  /** web_search query history for first-pass diversity + dedupe checks. */
  private webSearchQueriesThisTurn: string[] = [];
  /** Near-duplicate failed search intents for one-shot retry discipline. */
  private failedSearchIntentCounts = new Map<string, number>();
  /** Successful edit/write targets in this send, used for lint self-heal scoping. */
  private changedFilesThisTurn = new Set<string>();
  /** Related files observed from lint diagnostics in this send. */
  private lintRelatedFilesThisTurn = new Set<string>();

  /** Active persona. Set via setPersona(); defaults to config.persona or unnamed default. */
  private currentPersona?: PersonaConfig;
  /** Long-horizon runtime state persisted by task_checkpoint and heartbeat events. */
  private executionState: ExecutionState | null = null;
  private vaultMetrics = { reads: 0, searches: 0, writes: 0, skippedWrites: 0 };
  private runtimePreferences: RuntimePreferences | null = null;
  private pendingRiskyPreferenceSummary: string | null = null;
  private turnInference: TurnInferenceResult | null = null;

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
    return this.turnInference?.intent === "knowledge";
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

  private rememberChangedPathFromToolCall(toolName: string, argsJson: string, ok: boolean): void {
    if (!ok) return;
    const editTools = new Set([
      "write_file",
      "patch_file",
      "apply_diff",
      "write_file_if_changed",
      "search_replace_file",
      "move_file",
      "copy_file",
      "copy_tree",
      "multi_file_apply",
      "refactor_plan_apply",
    ]);
    if (!editTools.has(toolName)) return;
    try {
      const args = JSON.parse(argsJson) as Record<string, unknown>;
      const candidates: string[] = [];
      for (const key of ["path", "to", "target", "target_path", "dest", "destination"]) {
        const v = args[key];
        if (typeof v === "string" && v.trim().length > 0) candidates.push(v.trim());
      }
      const arr = args["paths"];
      if (Array.isArray(arr)) {
        for (const it of arr) {
          if (typeof it === "string" && it.trim().length > 0) candidates.push(it.trim());
        }
      }
      for (const c of candidates) this.changedFilesThisTurn.add(c);
    } catch {
      /* ignore malformed args json */
    }
  }

  private resolveSelfHealMode(): LintMode {
    const raw = (process.env["AGENT_SELF_HEAL_LINT_MODE"] ?? "tsc").toLowerCase();
    if (raw === "eslint" || raw === "command") return raw;
    return "tsc";
  }

  private resolveSelfHealChangedFirstScope(): string[] {
    const files = [...this.changedFilesThisTurn];
    if (files.length === 0) return ["."];
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
    if (process.env["AGENT_SELF_HEAL_LINT"] !== "1") return;
    if (this.agentDepth > 0) return;
    if (!this.registry.has("run_lint")) return;
    const changedFirstScope = this.resolveSelfHealChangedFirstScope();
    if (changedFirstScope.length === 0) return;
    const maxPasses = Math.max(
      1,
      Math.min(8, parseInt(process.env["AGENT_SELF_HEAL_MAX_PASSES"] ?? "4", 10) || 4)
    );
    const stopOnNoProgress = process.env["AGENT_SELF_HEAL_STOP_ON_NO_PROGRESS"] !== "0";
    const repoWide = process.env["AGENT_SELF_HEAL_REPO_WIDE"] === "1";
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

  private rebuildClient(): void {
    this.client = new OpenAI({
      apiKey: this.config.openRouterApiKey,
      baseURL: this.config.baseURL,
      maxRetries: 0,
      defaultHeaders: {
        "HTTP-Referer": "https://github.com/liminal-ai",
        "X-Title": "Liminal",
      },
    });
  }

  private askUserDirect(prompt: string): Promise<string> {
    return new Promise<string>((resolve) => {
      this.emitter.emit("ask_user", { prompt, resolve });
    });
  }

  private async maybeHandleRuntimePreferenceIntent(userMessage: string): Promise<void> {
    if (this.agentDepth > 0) return;
    if (
      !/\b(from now on|going forward|default to|always use|prefer|switch|change|set|be more autonomous|lower confirmations?|fewer confirmations?|quieter|verbosity|retry|timeout|approval|vault|provider|model)\b/i.test(
        userMessage
      )
    ) {
      return;
    }
    const jr = await completeChatJson(this.client, {
      model: getFastModelSlug(this.config.model),
      messages: [
        {
          role: "system",
          content:
            "Extract runtime preference intent from user text. " +
            "Return JSON object: {detected:boolean, summary:string, risky:boolean, changes:{provider?:{model?:string,baseURL?:string,keySource?:string},runtime?:{uiVerbosity?:'normal'|'quiet',vaultAutoWriteMode?:'off'|'research'|'aggressive',vaultFirstStrict?:boolean,approvalTimeoutMs?:number,destructiveGate?:'strict'|'balanced',rateLimitMaxRetries?:number,transient5xxMaxRetries?:number,retryMaxDelayMs?:number}}}. " +
            "Only include fields explicitly requested or strongly implied. " +
            "Treat requests for faster/more autonomous behavior as potentially implying reduced confirmations/guardrails. " +
            "risky=true when safety controls are reduced (for example: lower approval friction, looser destructive gate). " +
            "summary must be short and concrete.",
        },
        { role: "user", content: userMessage.slice(0, 2000) },
      ],
      maxTokens: 600,
      temperature: 0.1,
    });
    if (!jr.ok || typeof jr.parsed !== "object" || jr.parsed == null) return;
    const parsed = jr.parsed as {
      detected?: boolean;
      summary?: string;
      risky?: boolean;
      changes?: Partial<RuntimePreferences>;
    };
    if (!parsed.detected || !parsed.changes) return;
    const normalizedChanges = normalizeRuntimePreferencePatch(parsed.changes);
    if (!hasRuntimePreferenceChange(normalizedChanges)) return;
    const summary = (parsed.summary ?? "runtime preference change").slice(0, 240);
    const risky = Boolean(parsed.risky);
    this.emitter.emit("runtime_pref_detected", { summary, risky });
    this.emitter.emit("text", {
      delta: `\n[Runtime] Detected preference intent: ${summary}${risky ? " (risky)" : ""}\n`,
      channel: "trace",
    });

    if (risky) {
      this.pendingRiskyPreferenceSummary = summary;
      const answer = (
        await this.askUserDirect(
          `Risky runtime preference change detected: ${summary}. ` +
            `Reply exactly "confirm" to apply and persist, or anything else to reject.`
        )
      )
        .trim()
        .toLowerCase();
      if (answer !== "confirm") {
        this.emitter.emit("runtime_pref_rejected", { summary, reason: "user_rejected_or_not_confirmed" });
        this.emitter.emit("text", {
          delta: `\n[Runtime] Preference change rejected: ${summary} (confirmation not provided)\n`,
          channel: "trace",
        });
        this.pendingRiskyPreferenceSummary = null;
        return;
      }
      this.pendingRiskyPreferenceSummary = null;
    }

    this.applyRuntimePreferencePatch(normalizedChanges);
    this.emitter.emit("runtime_pref_changed", { summary, persisted: false });
    this.emitter.emit("text", {
      delta: `\n[Runtime] Applied preference change: ${summary}\n`,
      channel: "trace",
    });
    let persisted = false;
    if (this.config.persistRuntimePreferences) {
      try {
        const p = await this.config.persistRuntimePreferences(this.runtimePreferences!);
        persisted = true;
        if (typeof p === "string" && p.length > 0) {
          this.emitter.emit("runtime_pref_persisted", { path: p });
        }
      } catch (err) {
        this.emitter.emit("runtime_pref_rejected", {
          summary,
          reason: `persist_failed:${err instanceof Error ? err.message : String(err)}`,
        });
        this.emitter.emit("text", {
          delta:
            `\n[Runtime] Persist failed for preference change: ${summary} ` +
            `(${err instanceof Error ? err.message : String(err)})\n`,
          channel: "trace",
        });
      }
    }
    this.emitter.emit("runtime_pref_changed", { summary, persisted });
    this.emitter.emit("text", {
      delta:
        `\n[Runtime] Preference change status: ${summary} -> ` +
        `${persisted ? "persisted" : "applied (session only)"}\n`,
      channel: "trace",
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
    if (merged.runtime?.uiVerbosity) {
      process.env["AGENT_UI_VERBOSITY"] = merged.runtime.uiVerbosity;
    }
    if (merged.runtime?.vaultAutoWriteMode) {
      process.env["AGENT_VAULT_AUTO_WRITE"] = merged.runtime.vaultAutoWriteMode;
    }
    if (typeof merged.runtime?.vaultFirstStrict === "boolean") {
      process.env["AGENT_VAULT_FIRST_STRICT"] = merged.runtime.vaultFirstStrict ? "1" : "0";
    }
    if (merged.runtime?.approvalTimeoutMs != null) {
      process.env["AGENT_APPROVAL_TIMEOUT_MS"] = String(merged.runtime.approvalTimeoutMs);
    }
    if (merged.runtime?.destructiveGate) {
      process.env["AGENT_DESTRUCTIVE_GATE"] = merged.runtime.destructiveGate;
    }
    if (merged.runtime?.rateLimitMaxRetries != null) {
      process.env["AGENT_RATE_LIMIT_MAX_RETRIES"] = String(merged.runtime.rateLimitMaxRetries);
    }
    if (merged.runtime?.transient5xxMaxRetries != null) {
      process.env["AGENT_TRANSIENT_5XX_MAX_RETRIES"] = String(merged.runtime.transient5xxMaxRetries);
    }
    if (merged.runtime?.retryMaxDelayMs != null) {
      process.env["AGENT_RETRY_MAX_DELAY_MS"] = String(merged.runtime.retryMaxDelayMs);
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
    const raw = process.env["AGENT_RETRY_MAX_DELAY_MS"]?.trim();
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
    const raw = process.env["AGENT_RATE_LIMIT_MAX_RETRIES"]?.trim();
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
    const raw = process.env["AGENT_TRANSIENT_5XX_MAX_RETRIES"]?.trim();
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
    const raw = process.env["AGENT_RETRY_WALL_TIME_MS"]?.trim();
    if (raw) {
      const n = parseInt(raw, 10);
      if (Number.isFinite(n)) return Math.max(10_000, Math.min(900_000, n));
    }
    return 120_000;
  }
  private get providerCircuitFailureThreshold() {
    const raw = process.env["AGENT_PROVIDER_CIRCUIT_FAILURES"]?.trim();
    if (raw) {
      const n = parseInt(raw, 10);
      if (Number.isFinite(n)) return Math.max(2, Math.min(20, n));
    }
    return 4;
  }
  private get providerCircuitCooldownMs() {
    const raw = process.env["AGENT_PROVIDER_CIRCUIT_COOLDOWN_MS"]?.trim();
    if (raw) {
      const n = parseInt(raw, 10);
      if (Number.isFinite(n)) return Math.max(5_000, Math.min(300_000, n));
    }
    return 45_000;
  }

  constructor(config: AgentConfig) {
    this.config = config;
    this.config.vision = {
      model: config.vision?.model ?? process.env["AGENT_VISION_MODEL"]?.trim(),
      baseURL: config.vision?.baseURL ?? process.env["AGENT_VISION_BASE_URL"]?.trim(),
      apiKey: config.vision?.apiKey ?? process.env["AGENT_VISION_API_KEY"]?.trim(),
      timeoutMs:
        config.vision?.timeoutMs ??
        (parseInt(process.env["AGENT_VISION_TIMEOUT_MS"] ?? "15000", 10) || 15_000),
      maxImageBytes:
        config.vision?.maxImageBytes ??
        (parseInt(process.env["AGENT_VISION_MAX_IMAGE_BYTES"] ?? String(4 * 1024 * 1024), 10) || 4 * 1024 * 1024),
    };
    this.runtimePreferences = config.runtimePreferences ?? null;
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
    this.readFilePathCountsThisTurn = new Map();
    this.largeReadPivotNudgeThisSend = false;
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
    this.pseudoToolMarkupRetryRemaining = Math.max(
      0,
      Math.min(3, parseInt(process.env["AGENT_PSEUDO_TOOL_RETRY_MAX"] ?? "2", 10) || 2)
    );
    this.pseudoMarkupSuppressCountThisSend = 0;
    this.pseudoMarkupSuppressionNotifiedThisSend = false;
    this.finalizeCiteNudgeThisSend = false;
    this.finalizeSynthesisNudgeThisSend = false;
    this.finalizeRecencyNudgeThisSend = false;
    this.finalizeInferenceNudgeThisSend = false;
    this.finalizeRetryBudgetThisSend = Math.max(
      0,
      Math.min(2, parseInt(process.env["AGENT_FINALIZE_RETRY_BUDGET"] ?? "1", 10) || 1)
    );
    this.dispatcher.resetTurnCounters();
    this.vaultMetrics = { reads: 0, searches: 0, writes: 0, skippedWrites: 0 };
    this.webSearchQueriesThisTurn = [];
    this.failedSearchIntentCounts = new Map();
    this.changedFilesThisTurn = new Set();
    this.lintRelatedFilesThisTurn = new Set();
    this.turnInference = null;
    await this.maybeHandleRuntimePreferenceIntent(userMessage);
    try {
      this.turnInference = await inferTurnInference(this.client, this.config.model, userMessage);
    } catch {
      this.turnInference = {
        intent: "knowledge",
        stancePrompt: false,
        overInferenceRisk: false,
        identityQuery: isIdentityRecallLikePrompt(userMessage),
        deckIntent: false,
        freshnessSensitive: false,
        confidence: 0.5,
        source: "fallback_regex",
        reason: "inference_exception_fallback",
      };
    }

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
        harnessNotes: buildToolAwarenessSnapshot(this.registry, this.toolsUsedThisTurn),
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
      this.context.append({
        role: "user",
        content:
          "[SYSTEM NOTE] Capability awareness preface (non-forcing): use this to know all available families/tools, " +
          "then choose the minimal family activation only when needed.\n" +
          buildToolCapabilityManifest(this.registry),
      });

      // Send timeout is opt-in. By default we do not hard-abort long generations.
      // Set AGENT_SEND_TIMEOUT_MS to a positive value to enforce a wall-clock abort.
      const sendTimeoutRaw = parseInt(process.env["AGENT_SEND_TIMEOUT_MS"] ?? "0", 10) || 0;
      const sendTimeoutMs = sendTimeoutRaw > 0 ? Math.max(30_000, sendTimeoutRaw) : 0;
      if (sendTimeoutMs > 0) {
        let sendTimeoutId: ReturnType<typeof setTimeout> | undefined;
        const sendTimeoutPromise = new Promise<never>((_, reject) => {
          sendTimeoutId = setTimeout(
            () =>
              reject(
                new Error(
                  `Send timeout after ${Math.round(sendTimeoutMs / 1000)}s. ` +
                    "For large file generation, prefer sectioned write_file calls or run_shell with a heredoc."
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

    // Seed child active set AFTER onChildCreated so harness-scoped tools
    // (spawn_agent, wait_for_agents, check_context, …) are included.
    childRegistry.copyLazyPolicyFromParent(this.registry);

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
          .send(childConfig.userPrompt?.trim() ?? childConfig.goal)
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
    // Explicit opt-in only: avoid silent auto-capture into vault.
    if (process.env["AGENT_MEMORY_EPISODE"] !== "1") return;
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
    this.refreshToolAwareness("protocol_dynamic_refresh");

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
    const intent = this.turnInference?.intent ?? "knowledge";
    const memoryPolicy = resolveMemoryPolicy(intent, { userMessage: this.lastUserMessage });
    const inferenceThreshold = resolveIntentConfidenceThreshold();
    if (this.agentDepth === 0) {
      this.emitter.emit("memory_retrieval_policy", {
        intent,
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
      });
    }
    const round0PrimeEnabled = process.env["AGENT_MEMORY_PRIME_ROUND0"] !== "0";
    const shouldPrimeThisRound =
      recallEvery > 0 &&
      ((round > 0 && round % recallEvery === 0) || (round === 0 && round0PrimeEnabled));
    if (
      shouldPrimeThisRound &&
      this.agentDepth === 0 &&
      memoryPolicy.allowAutoRecall &&
      (this.registry.has("recall_relevant") || this.registry.has("memory_query"))
    ) {
      try {
        const seed = this.lastUserMessage.trim().slice(0, 400);
        const rw = this.recallRewriteThisSend;
        const sub =
          rw?.subQueries?.filter((q) => q.trim().length >= 4) ?? [];
        const identityLike =
          this.turnInference?.identityQuery ?? isIdentityRecallLikePrompt(this.lastUserMessage);
        // Identity queries get purpose-built BM25 seeds first — the raw question
        // ("do you know my name?") has zero lexical overlap with stored name facts.
        const queries =
          sub.length > 0
            ? sub
            : identityLike
            ? ["user name", "what should i call user", "identity", "preferred name"]
            : seed.length >= 8
            ? [seed]
            : [];
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
                goal_hint: this.lastUserMessage.slice(0, 500),
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
          if (rw?.hyde?.trim()) payload["hyde"] = rw.hyde.trim().slice(0, 1500);
          this.emitter.emit("memory_retrieval_policy", {
            intent,
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
            this.context.appendMessage({
              role: "user",
              content: `[Relevant memory — mid-turn recall]\n${r.output.slice(0, 3500)}`,
            });
          }
        }

        // For identity-like queries (name/who am I), BM25 IDF collapses for "user"
        // because it appears in hundreds of note keys. Bypass BM25 with direct exact
        // key lookups for known name-bearing keys.
        if (identityLike && this.registry.has("memory_query")) {
          const nameKeys = [
            "entity:user_name",
            "entity:user_full_name",
            "entity:preferred_name",
            "fact:user_name",
            "fact:preferred_name",
          ];
          const nameHits: string[] = [];
          for (const nameKey of nameKeys) {
            try {
              const nr = await this.dispatcher.directCall("memory_query", { mode: "exact", key: nameKey });
              if (nr.ok && typeof nr.output === "string" && nr.output.trim().length > 10) {
                nameHits.push(nr.output.trim());
              }
            } catch { /* optional */ }
          }
          if (nameHits.length > 0) {
            this.context.appendMessage({
              role: "user",
              content: `[Identity recall — stored name]\n${nameHits.join("\n")}`,
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
      });
    }

    const messages = this.context.buildMessages();
    const tools = this.registry.toOpenAIFormat();
    const accumulator = new StreamAccumulator();

    const chunkTimeoutMs = Math.max(
      10_000,
      parseInt(process.env["AGENT_STREAM_CHUNK_TIMEOUT_MS"] ?? "60000", 10) || 60_000
    );
    const maxStreamRetries = Math.max(
      0,
      parseInt(process.env["AGENT_STREAM_MAX_RETRIES"] ?? "3", 10) || 3
    );

    let stream = await this.streamWithRetry(messages, tools);
    let finishReason: string | null = null;
    let streamAttempt = 0;

    streamLoop: while (true) {
      try {
        for await (const chunk of withChunkTimeout(stream, chunkTimeoutMs)) {
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
        const hadPartialContent =
          accumulator.accumulatedText.length > 0 ||
          accumulator.accumulatedToolCalls.length > 0;

        accumulator.reset();
        finishReason = null;

        const retryLabel = isChunkTimeout
          ? `stream stalled (${Math.round(chunkTimeoutMs / 1000)}s without data)`
          : "stream connection reset";

        if (hadPartialContent && !isUiQuiet()) {
          this.emitter.emit("text", {
            delta: `\n\n[⟳ ${retryLabel} — restarting stream (attempt ${streamAttempt}/${maxStreamRetries})…]\n\n`,
            channel: "user",
          });
        }

        this.emitter.emit("provider_retry", {
          attempt: streamAttempt,
          maxAttempts: maxStreamRetries + 1,
          message: retryLabel,
          backoffMs: Math.min(2000 * streamAttempt, 10_000),
        });

        await sleep(Math.min(2000 * streamAttempt, 10_000));
        stream = await this.streamWithRetry(messages, tools);
      }
    }

    const toolCalls = accumulator.accumulatedToolCalls;
    const accumulatedText = accumulator.accumulatedText;
    const assistantMessage = this.buildAssistantMessage(
      accumulatedText,
      toolCalls
    );

    // If stream ended without an explicit finish reason, treat as potentially incomplete
    // and request continuation before running finalization/verification logic.
    if (
      finishReason == null &&
      toolCalls.length === 0 &&
      accumulatedText.trim().length > 0 &&
      this.lengthResumeRemaining > 0
    ) {
      this.lengthResumeRemaining--;
      this.context.append(assistantMessage);
      this.context.appendMessage({
        role: "user",
        content:
          "[CONTINUE] The previous assistant message appears incomplete (no finish reason). " +
          "Continue exactly where you left off and finish before verification/finalization.",
      });
      await this.runReActLoop(round);
      return;
    }

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

    if (
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
      let awarenessNeedsRefresh = false;
      let awarenessReason = "";

      for (let i = 0; i < toolCalls.length; i++) {
        const tc = toolCalls[i]!;
        const r = results[i]!;
        this.rememberChangedPathFromToolCall(tc.name, tc.argsJson, r.ok);
        const line = `${tc.name}:${r.ok ? "ok" : "fail"}`;
        this.recentToolOutcomeLines.push(line.slice(0, 160));
        if (this.recentToolOutcomeLines.length > 3) this.recentToolOutcomeLines.shift();
        if (r.ok && tc.name === "read_file") {
          try {
            const a = JSON.parse(tc.argsJson) as { path?: string };
            if (a.path) {
              this.filesReadThisTurn.push(a.path);
              if (this.filesReadThisTurn.length > 24) this.filesReadThisTurn.shift();
              const key = a.path.replace(/\\/g, "/").toLowerCase();
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
            }
          } catch {
            /* ignore */
          }
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
              "Switch to targeted access: read_file_chunked, read_file with offset/limit, or file_metadata for integrity checks; " +
              "then run verification tools (run_lint/run_tests/browser_open include_console=true) as appropriate.",
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

      await this.runLintSelfHealIfNeeded();

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
      const skipCriticForSimpleIntrospection =
        distinctToolCount <= 1 &&
        this.toolsUsedThisTurn.filter((n) => n !== "think" && n !== "plan").length === 0 &&
        isSimpleIntrospectionPrompt(this.lastUserMessage);
      const runHeuristicCritic =
        process.env["AGENT_CRITIC"] === "1" &&
        !this.criticConsumedThisSend &&
        this.roundCount >= 3 &&
        this.agentDepth === 0 &&
        this.registry.has("verify_result") &&
        shouldRunCriticPass(assistantText);

      if ((runForcedCritic || runHeuristicCritic) && !skipCriticForSimpleIntrospection) {
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
      const hasWebFetchEvidence = this.toolsUsedThisTurn.includes("web_fetch");
      const substantiveDraftLikelyComplete =
        assistantText.length >= 1800 ||
        ((assistantText.match(/\n[-*]\s/g) ?? []).length >= 6 &&
          (assistantText.match(/\b(source|sources|as of|uncertain|open|timeline|update)\b/gi) ?? []).length >= 3) ||
        (hasWebFetchEvidence && distinctToolCount >= 6);
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
          if (this.finalizeRetryBudgetThisSend > 0 && !substantiveDraftLikelyComplete) {
            this.finalizeRetryBudgetThisSend--;
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
          const synthesisCaveat =
            "\n\nCoverage note: this draft appears substantively complete, so I am finalizing without more fetch retries. " +
            "Treat fine-grained chronology/source density as provisional where direct verification was blocked.";
          this.context.appendMessage({ role: "assistant", content: synthesisCaveat });
          this.emitter.emit("text", { delta: synthesisCaveat, channel: "user" });
        }
      }

      if (
        (this.turnInference?.deckIntent ?? isDeckIntentPrompt(this.lastUserMessage)) &&
        !this.toolsUsedThisTurn.includes("doc_render_pptx") &&
        !this.finalizeDeckPipelineNudgeThisSend
      ) {
        this.finalizeDeckPipelineNudgeThisSend = true;
        this.context.appendMessage({
          role: "user",
          content:
            "[PPTX COMPLETION GUARD] User requested a deck/PPTX. Before finalizing, run the document pipeline and produce artifacts: " +
            "doc_plan -> doc_compose_chunk -> doc_lint_layout/doc_repair_chunk -> doc_render_pptx -> doc_export -> doc_quality_report. " +
            "Do not finalize with markdown-only output unless pptx rendering fails; if it fails, return diagnostics and retry guidance.",
        });
        await this.runReActLoop(round);
        return;
      }

      if (
        isVisionCentricPrompt(this.lastUserMessage) &&
        !this.toolsUsedThisTurn.includes("vision_analyze") &&
        !this.finalizeVisionNudgeThisSend
      ) {
        this.finalizeVisionNudgeThisSend = true;
        this.context.appendMessage({
          role: "user",
          content:
            "[VISION COMPLETION GUARD] This looks image-centric. Before finalizing, use vision_analyze (and activate/load vision family if needed). " +
            "If vision call fails, continue with explicit lower-confidence uncertainty notes instead of pretending image evidence was seen.",
        });
        await this.runReActLoop(round);
        return;
      }

      const stancePrompt =
        isOverInferenceGuardEnabled() &&
        (this.turnInference?.stancePrompt || this.turnInference?.overInferenceRisk || false);
      const heuristicRisk = stancePrompt && hasOverconfidentUserStanceClaims(assistantText);
      let llmRisk = false;
      let llmCheckConfidence: number | undefined;
      let llmFixHint: string | undefined;
      let llmCheckReason: string | undefined;
      if (stancePrompt) {
        const semantic = await evaluateOverInferenceSemantics(
          this.client,
          this.config.model,
          this.lastUserMessage,
          assistantText
        );
        llmRisk = !semantic.passed;
        llmCheckConfidence = semantic.confidence;
        llmFixHint = semantic.fixHint;
        llmCheckReason = semantic.reason;
      }
      const overInferenceRisk = heuristicRisk || llmRisk;
      this.emitter.emit("over_inference_check", {
        required: stancePrompt,
        passed: !overInferenceRisk,
        reason: !stancePrompt
          ? "not_user_stance_prompt"
          : overInferenceRisk && llmRisk
          ? `semantic_over_inference:${llmCheckReason ?? "failed"}`
          : overInferenceRisk
          ? "heuristic_overconfident_user_stance_without_uncertainty"
          : "user_stance_framed_with_uncertainty",
        attemptedRecovery: overInferenceRisk,
        source: stancePrompt ? (llmRisk ? "llm" : heuristicRisk ? "heuristic" : "llm") : "none",
        confidence: llmCheckConfidence,
        threshold: resolveIntentConfidenceThreshold(),
        fixHint: llmFixHint,
      });
      if (overInferenceRisk && !this.finalizeInferenceNudgeThisSend) {
        this.finalizeInferenceNudgeThisSend = true;
        this.context.appendMessage({
          role: "user",
          content:
            "[OVER-INFERENCE CHECK] Rewrite using this structure: " +
            "(1) What you explicitly said, (2) Possible inference (tentative + confidence low/med/high), " +
            "(3) Open uncertainty. Do not treat user questions as confirmed beliefs. " +
            (llmFixHint ? `Fix hint: ${llmFixHint}` : ""),
        });
        await this.runReActLoop(round);
        return;
      }

      const liveNowClaimed = hasLiveNowClaims(assistantText);
      const recencyRequired =
        (this.turnInference?.freshnessSensitive ?? isFreshnessSensitivePrompt(this.lastUserMessage)) ||
        liveNowClaimed;
      if (recencyRequired) {
        const evidenceBlob = this.evidenceLog.map((e) => e.excerpt).join("\n");
        const weatherFresh = hasWeatherFreshEvidence(`${assistantText}\n${evidenceBlob}`);
        const recencyPassed =
          (!hasFreshnessClaims(assistantText) || hasAsOfQualifier(assistantText)) &&
          (hasRecentYearEvidence(`${assistantText}\n${evidenceBlob}`) || weatherFresh) &&
          (hasAuthoritativeSourceHint(`${assistantText}\n${evidenceBlob}`) || weatherFresh);
        this.emitter.emit("recency_check", {
          required: true,
          passed: recencyPassed,
          reason: recencyPassed
            ? "freshness_claims_grounded"
            : liveNowClaimed
            ? "live_now_claim_missing_fresh_weather_evidence"
            : "missing_as_of_or_recent_authoritative_evidence",
          attemptedRecovery: !recencyPassed,
        });
        if (!recencyPassed && !this.finalizeRecencyNudgeThisSend) {
          if (this.finalizeRetryBudgetThisSend > 0 && !substantiveDraftLikelyComplete) {
            this.finalizeRetryBudgetThisSend--;
            this.finalizeRecencyNudgeThisSend = true;
            this.context.appendMessage({
              role: "user",
              content:
                "[RECENCY CHECK] Your answer appears freshness-sensitive. Before finalizing: " +
                "(1) verify latest/current/version claims against an authoritative source, " +
                "(2) include an explicit 'as of <date>' qualifier, and " +
                "(3) if sources conflict or latest cannot be verified, state uncertainty clearly.",
            });
            await this.runReActLoop(round);
            return;
          }
        }
        if (!recencyPassed) {
          const caveat =
            "\n\nAs of now, I could not fully verify the latest authoritative state. " +
            "Treat version/current claims as provisional until confirmed from official release/docs sources.";
          this.context.appendMessage({ role: "assistant", content: caveat });
          this.emitter.emit("text", { delta: caveat, channel: "user" });
        }
      } else {
        this.emitter.emit("recency_check", {
          required: false,
          passed: true,
          reason: "not_freshness_sensitive",
          attemptedRecovery: false,
        });
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
    const retryStartedAt = Date.now();

    const allowToollessRetry = this.config.allowToollessStreamRetry !== false;
    let attempt = 0;
    while (true) {
      if (Date.now() < this.providerCircuitOpenUntilMs) {
        const sec = Math.ceil((this.providerCircuitOpenUntilMs - Date.now()) / 1000);
        throw new Error(`Provider circuit open due to repeated upstream failures. Retry in ~${sec}s.`);
      }
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
        const stream = (await this.client.chat.completions.create(
          params,
          ...(this.abortSignal ? [{ signal: this.abortSignal }] : [])
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
          const minCap = Math.max(1, parseInt(process.env["AGENT_MIN_CONCURRENT_AGENTS"] ?? "1", 10) || 1);
          this.spawnConcurrencyCap = Math.max(minCap, Math.floor(this.spawnConcurrencyCap / 2));
          const cooldown = Math.max(delay, parseInt(process.env["AGENT_CONCURRENCY_COOLDOWN_MS"] ?? "45000", 10) || 45_000);
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
        if (!isUiQuiet()) {
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
