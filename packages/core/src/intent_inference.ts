import OpenAI from "openai";
import { completeChatJson, getFastModelSlug } from "./router.js";
import { effectiveHarnessEnvRaw } from "./harness_effective_env.js";
import {
  applyFallbackReasoningFields,
  fallbackReasoningBudget,
  parseReasoningBudgetFromParsed,
  type ReasoningEffort,
  type ThinkDepth,
  type TurnComplexity,
} from "./reasoning_profile.js";
import {
  isBuildDeliverableUserMessage,
  isImplementShipUserMessage,
  isResearchFreshnessUserMessage,
} from "./reasoning_surface.js";
import { detectWorkflowSignal } from "./workflow_spec.js";

export type TurnIntentClass =
  | "introspection"
  | "knowledge"
  | "research"
  | "coding"
  | "execution"
  | "conversational"
  | "creative";

export type { TurnComplexity } from "./reasoning_profile.js";

/** Tool name filter presets for each routing tier. */
const ROUTING_TOOL_FILTERS: Record<TurnIntentClass, ((name: string) => boolean) | null> = {
  introspection: (n) =>
    n === "recall_relevant" || n === "memory_query" || n === "search_memory" ||
    n === "recall" || n === "recall_type" || n === "read_file" || n === "think" || n === "plan",
  knowledge: (n) =>
    !["run_shell", "run_background", "git_commit", "git_checkpoint",
      "run_tests", "run_lint", "execute_code"].includes(n),
  // research: same tool surface as knowledge — no destructive shell/git/code,
  // but full web + memory + file read access for multi-source investigation.
  research: (n) =>
    !["run_shell", "run_background", "git_commit", "git_checkpoint",
      "run_tests", "run_lint", "execute_code"].includes(n),
  coding: null, // all tools
  execution: null, // all tools
  // conversational: empty surface except think/plan — chitchat/persona/continuation
  // turns should never reach for tools. Memory recall is gated separately by
  // resolveMemoryPolicy (identity-query turns DO get vault/notes recall).
  conversational: (n) => n === "think" || n === "plan",
  // creative: generative writing — no shell/git/execution, no web (those are research),
  // but allow read + memory + write_file so drafts can land on disk.
  creative: (n) =>
    !["run_shell", "run_background", "git_commit", "git_checkpoint",
      "run_tests", "run_lint", "execute_code", "web_search", "web_fetch",
      "browser_open", "browser_act", "browser_navigate"].includes(n),
};

export interface RoutingProfile {
  /** Model slug to use for this turn (may differ from main model). */
  modelSlug: string;
  /** Optional tool filter — null means all tools. */
  toolFilter: ((name: string) => boolean) | null;
  /** max_tokens override for this turn (0 = no override). */
  maxTokens: number;
  /** Whether routing was actually applied (false when disabled or confidence too low). */
  applied: boolean;
  intent: TurnIntentClass;
  /** Estimated turn complexity — orthogonal to intent. Drives fast-model routing. */
  complexity: TurnComplexity;
  /** Where intent came from: "llm" | "heuristic" | "default" | "fallback" | etc. */
  source: string;
  /** Confidence score [0–1] from intent classification. */
  confidence: number;
  /** Whether a tool name filter is active (limits the tool surface for this turn). */
  toolFilterActive: boolean;
  /** Why this turn was (or wasn't) routed to the fast model — for trace + future training. */
  routingReason: string;
}

function resolveIntentFastThreshold(): number {
  const n = Number(effectiveHarnessEnvRaw("AGENT_INTENT_FAST_THRESHOLD") ?? "0.8");
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.8;
}

function resolveFastModelSlug(mainModel: string): string {
  // AGENT_INTENT_OPERATIONAL_MODEL is kept as a legacy alias for back-compat with
  // existing .env files; new code should set AGENT_FAST_MODEL directly.
  return (
    effectiveHarnessEnvRaw("AGENT_FAST_MODEL")?.trim() ||
    effectiveHarnessEnvRaw("AGENT_INTENT_OPERATIONAL_MODEL")?.trim() ||
    mainModel
  );
}

function isComplexityFastRoutingEnabled(): boolean {
  // Off by default — flipping this on lets ANY trivial-complexity turn route to
  // the fast model regardless of intent, which is the new policy lever this
  // refactor introduces. Gated so existing users don't see behavior shift overnight.
  return effectiveHarnessEnvRaw("AGENT_COMPLEXITY_ROUTING") === "1";
}

/**
 * Produce a routing profile for the given intent inference result.
 * When AGENT_INTENT_ROUTING is not "1", returns a no-op profile.
 */
export function buildRoutingProfile(
  inference: TurnInferenceResult | null,
  mainModel: string
): RoutingProfile {
  const noOp: RoutingProfile = {
    modelSlug: mainModel,
    toolFilter: null,
    maxTokens: 0,
    applied: false,
    intent: inference?.intent ?? "knowledge",
    complexity: inference?.complexity ?? "normal",
    source: inference?.source ?? "default",
    confidence: inference?.confidence ?? 0,
    toolFilterActive: false,
    routingReason: "routing_disabled",
  };

  if (effectiveHarnessEnvRaw("AGENT_INTENT_ROUTING") !== "1") return noOp;
  if (!inference) return noOp;

  const threshold = resolveIntentFastThreshold();
  const confidence = inference.confidence ?? 0;
  const intent = inference.intent;
  const complexity: TurnComplexity = inference.complexity ?? "normal";

  let modelSlug = mainModel;
  let maxTokens = 0;
  let routingReason = "main_model_default";

  // Per-intent base policy.
  //
  // Token budgets are split into two regimes:
  //   - Fixed-shape Q&A intents (conversational/introspection/knowledge) — tight
  //     caps because the deliverable is a contained natural-language reply.
  //   - Agentic intents (research/coding/execution/creative) — generous caps
  //     because the deliverable is real work: file writes, multi-round tool
  //     chains, long generated artifacts. Capping these at 4–8k forces multiple
  //     length-resume rounds on big single-file writes (a Socratic browser OS,
  //     a slide deck, a multi-section essay) and is the most common cause of
  //     "the model isn't using the tool" stalls during heavy generation.
  if (intent === "conversational") {
    // Always fast — chitchat/persona/continuation never need the main model.
    modelSlug = resolveFastModelSlug(mainModel);
    maxTokens = 768;
    routingReason = "conversational_always_fast";
  } else if (intent === "introspection") {
    if (confidence >= threshold) {
      modelSlug = resolveFastModelSlug(mainModel);
      maxTokens = 2048;
      routingReason = "introspection_high_confidence";
    } else {
      maxTokens = 2048;
      routingReason = "introspection_low_confidence_main";
    }
  } else if (intent === "knowledge") {
    maxTokens = 4096;
    if (
      confidence >= threshold &&
      inference.likelyEditPaths.length === 0 &&
      !inference.freshnessSensitive
    ) {
      modelSlug = resolveFastModelSlug(mainModel);
      routingReason = "knowledge_high_confidence_fast";
    }
  } else if (intent === "research") {
    // Multi-source synthesis; final answers can be long-form briefings.
    maxTokens = 16000;
  } else if (intent === "creative") {
    // Single-shot generative writing — often the *whole* turn budget needs to
    // fit in one completion (story, deck script, full HTML page). Big cap.
    maxTokens = 24000;
  } else if (intent === "coding") {
    // Whole-file writes, refactor patches, multi-file applies. Big cap.
    maxTokens = 24000;
  } else if (intent === "execution") {
    // Build/deploy/CI pipelines — bigger than research, smaller than coding.
    maxTokens = 16000;
  }

  // Complexity override: trivial turns route to fast model regardless of intent
  // (with creative excluded — generation quality matters even on short prompts).
  // Gated behind AGENT_COMPLEXITY_ROUTING so it's opt-in until we have outcome
  // data to validate the policy.
  if (
    isComplexityFastRoutingEnabled() &&
    complexity === "trivial" &&
    intent !== "creative" &&
    confidence >= threshold &&
    inference.source === "llm" &&
    modelSlug === mainModel
  ) {
    modelSlug = resolveFastModelSlug(mainModel);
    maxTokens = Math.min(maxTokens || 2048, 2048);
    routingReason = `complexity_trivial_${intent}`;
  }

  // Only apply tool filters for high-confidence LLM classifications.
  // Fallback/default inferences always see all tools — don't silently strip
  // shell/git/code from messages the classifier wasn't confident about.
  // Exception: conversational is *always* tool-filtered when applied, because the
  // whole point of the class is "no tools needed" and getting it wrong is cheap.
  const applyToolFilter =
    intent === "conversational" ||
    (inference.source === "llm" && confidence >= threshold);
  const toolFilter = applyToolFilter ? (ROUTING_TOOL_FILTERS[intent] ?? null) : null;

  return {
    modelSlug,
    toolFilter,
    maxTokens,
    applied: modelSlug !== mainModel || maxTokens > 0,
    intent,
    complexity,
    source: inference.source ?? "default",
    confidence: inference.confidence ?? 0,
    toolFilterActive: toolFilter !== null,
    routingReason,
  };
}

export interface MemoryPolicy {
  allowAutoRecall: boolean;
  scope: "notes" | "vault" | "both";
  maxAgeDays?: number;
  minConfidence?: number;
  minQueryOverlap?: number;
  excludeTypes?: string[];
}

export interface TurnInferenceResult {
  intent: TurnIntentClass;
  /**
   * Estimated turn complexity — orthogonal to intent. The router uses this to
   * decide whether the fast model can handle the turn (any intent + trivial =
   * fast model when AGENT_COMPLEXITY_ROUTING=1).
   *   - trivial: one-shot Q&A, single tool call, no multi-step reasoning needed.
   *   - normal: 2–8 tool calls, single coherent goal, no cross-file refactor.
   *   - complex: long-horizon, multi-file, cross-domain synthesis, ambiguous goal.
   */
  complexity: TurnComplexity;
  /**
   * Repo-relative paths the user will likely need to open or edit this turn,
   * inferred from the user message plus optional workspace cues (session file lists, shallow tree).
   */
  likelyEditPaths: string[];
  stancePrompt: boolean;
  overInferenceRisk: boolean;
  /**
   * Open-ended / hypothetical / creative ideation (blue-sky, "if you could build…",
   * "what would make X more likely") — prefer novel synthesis over defaulting to
   * stored project roadmaps or trajectory notes unless the user tied this turn to that work.
   */
  exploratoryCreative: boolean;
  /** User is asking about their name / who they are / what to call them. */
  identityQuery: boolean;
  /** User is stating their name or what to call them (store to memory). */
  identityProvision: boolean;
  /** User asks for assistant persona/identity ("who are you", "your persona"). */
  personaIdentityPrompt: boolean;
  /** User explicitly asks model/runtime/provider details. */
  runtimeIdentityPrompt: boolean;
  /** User wants a presentation, slide deck, or similar visual document. */
  deckIntent: boolean;
  /** User needs current, live, or recent information. */
  freshnessSensitive: boolean;
  /**
   * User wants the assistant to look at an image, screenshot, diagram, photo,
   * figure, or to OCR / extract text from a picture. Classifier-predicted so it
   * understands paraphrases ("can you see what this chart is saying?", "what's
   * happening in the upper-left of this screencap") that a keyword regex misses.
   * The agent uses this to nudge `vision_analyze` activation at finalize time.
   */
  visionIntent: boolean;
  /**
   * User asked for a runnable/openable artifact on disk (file, app, page, game, OS, deck).
   * Predicted by the fast-model classifier rather than regex matching, so it understands
   * paraphrases like "spin up a Tetris clone" or "throw together a Socratic dashboard"
   * without requiring an exhaustive keyword list. Falls back to a regex check (see
   * isBuildDeliverableUserMessage) only when the classifier failed or was low-confidence.
   */
  buildDeliverable: boolean;
  /**
   * User is on the implement-and-ship path — "make it runnable", "run it", "test it",
   * "zero-shot Python algorithm", "from scratch". A subtype of buildDeliverable that
   * additionally forces essayRisk=true; the classic "model writes a 2000-word algorithm
   * essay before calling write_file" failure mode.
   */
  implementShip: boolean;
  /**
   * User is asking to change runtime preferences (especially persona controls).
   * Route via explicit runtime tools (set_runtime_settings / set_persona), not memory tools.
   */
  runtimePreferenceIntent: boolean;
  /** User asks to read/check current runtime or persona control values. */
  runtimeSettingsQuery: boolean;
  /**
   * Task is a strong fit for a DYNAMIC WORKFLOW: it splits into many INDEPENDENT
   * sub-tasks that can run in parallel — codebase-wide audits/sweeps, large
   * migrations/refactors, building many components in parallel, or multi-angle
   * research that cross-checks sources. The harness auto-activates the workflow
   * tools and nudges toward plan_workflow → run_workflow when this is true.
   * (Replaces the regex heuristic when the classifier is trusted.)
   */
  workflowSuitable: boolean;
  /**
   * User mainly wants a short assistant self-intro, persona surface, or compact capability
   * overview — skip harness [CONTINUE] / finalize extension chains unless they asked for
   * substantive work.
   */
  skipHarnessSecondaryPasses: boolean;
  confidence: number;
  /** "llm" = classified by fast model, "default" = neutral fallback (inference off or timed out). */
  source: "llm" | "default";
  reason: string;
  fallbackReason?: string;
  /** Adaptive reasoning budget (fast classifier); see reasoning_profile.ts */
  reasoningEffort?: ReasoningEffort;
  thinkDepth?: ThinkDepth;
  toolFirstBias?: boolean;
  reasoningWordBudget?: number;
  essayRisk?: boolean;
  reasoningBudgetSource?: "llm" | "fallback";
}

/** Optional workspace cues passed into {@link inferTurnInference} (bounded; never full file bodies). */
export interface IntentInferenceWorkspaceContext {
  /** Accumulated from prior sends' epistemic state (merged set, newest entries last). */
  epistemicFilesModified?: string[];
  epistemicFilesTouched?: string[];
  /** Shallow tree lines from {@link gatherRepoMapLines} when `AGENT_INTENT_REPO_CONTEXT=1`. */
  repoMapLines?: string[];
  /** Truncated last assistant visible reply for vague follow-ups ("keep going on that"). */
  lastAssistantSnippet?: string;
}

export interface OverInferenceSemanticResult {
  passed: boolean;
  reason: string;
  confidence: number;
  source: "llm" | "heuristic";
  fixHint?: string;
}

/** Deterministic defaults when inference is off, the LLM call fails, or send() catches. */
export function neutralTurnInferenceResult(
  reason: string,
  extra?: Partial<Omit<TurnInferenceResult, "source" | "reason">> & { fallbackReason?: string }
): TurnInferenceResult {
  const intent = extra?.intent ?? "knowledge";
  const exploratoryCreative = extra?.exploratoryCreative ?? false;
  const fb = fallbackReasoningBudget(intent, exploratoryCreative);
  return {
    intent,
    complexity: extra?.complexity ?? "normal",
    likelyEditPaths: [],
    stancePrompt: false,
    overInferenceRisk: false,
    exploratoryCreative,
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
    skipHarnessSecondaryPasses: false,
    workflowSuitable: false,
    confidence: 0.5,
    reasoningEffort: fb.reasoningEffort,
    thinkDepth: fb.thinkDepth,
    toolFirstBias: fb.toolFirstBias,
    reasoningWordBudget: fb.reasoningWordBudget,
    essayRisk: fb.essayRisk,
    reasoningBudgetSource: "fallback",
    ...(extra ?? {}),
    source: "default",
    reason,
  };
}

/**
 * Parse the classifier's `intent` string into our taxonomy. Legacy `operational`
 * (pre-refactor) maps to `execution` so persisted recipe_library entries and
 * old eval traces still load without producing `null` here.
 */
function parseIntent(value: unknown): TurnIntentClass | null {
  if (
    value === "introspection" || value === "knowledge" || value === "research" ||
    value === "coding" || value === "execution" ||
    value === "conversational" || value === "creative"
  ) {
    return value;
  }
  if (value === "operational") return "execution";
  return null;
}

function parseComplexity(value: unknown): TurnComplexity | null {
  if (value === "trivial" || value === "normal" || value === "complex") return value;
  return null;
}

export function parseLikelyEditPathsField(value: unknown, max = 8): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const v of value) {
    if (typeof v !== "string") continue;
    const t = v.replace(/\\/g, "/").trim();
    if (t.length < 2 || t.length > 512) continue;
    if (!out.includes(t)) out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

function resolveIntentContextMaxChars(): number {
  const raw = effectiveHarnessEnvRaw("AGENT_INTENT_CONTEXT_MAX_CHARS")?.trim();
  const n = raw ? Number(raw) : 12000;
  if (!Number.isFinite(n)) return 12000;
  return Math.max(2000, Math.min(50000, Math.round(n)));
}

export interface IntentInferenceComposeOptions {
  /** Bypasses `AGENT_INTENT_CONTEXT_MAX_CHARS` (used by unit tests; not for production). */
  maxCharsOverride?: number;
}

/** Assemble the user-role payload for intent LLM classification (size-capped). */
export function buildIntentInferenceUserContent(
  userMessage: string,
  workspace?: IntentInferenceWorkspaceContext,
  compose?: IntentInferenceComposeOptions
): string {
  const parts: string[] = [];
  parts.push(`USER_MESSAGE:\n${userMessage.slice(0, 2000)}`);
  if (workspace) {
    const { epistemicFilesModified, epistemicFilesTouched, repoMapLines, lastAssistantSnippet } = workspace;
    if (epistemicFilesModified?.length) {
      parts.push(
        "RECENT_FILES_MODIFIED_IN_SESSION (cumulative; newest last):\n" +
          epistemicFilesModified.slice(-28).join("\n")
      );
    }
    if (epistemicFilesTouched?.length) {
      parts.push(
        "RECENT_FILES_READ_IN_SESSION (cumulative; newest last):\n" + epistemicFilesTouched.slice(-20).join("\n")
      );
    }
    const las = lastAssistantSnippet?.trim();
    if (las) {
      parts.push(`LAST_ASSISTANT_REPLY_SNIPPET:\n${las.slice(0, 1200)}`);
    }
    if (repoMapLines?.length) {
      parts.push("REPO_TREE_SHALLOW:\n" + repoMapLines.join("\n"));
    }
  }
  let body = parts.join("\n\n");
  const max =
    compose?.maxCharsOverride != null && Number.isFinite(compose.maxCharsOverride)
      ? Math.max(80, Math.min(50000, Math.round(compose.maxCharsOverride)))
      : resolveIntentContextMaxChars();
  if (body.length > max) {
    body = body.slice(0, max) + "\n…[intent_context_truncated]";
  }
  return body;
}

function resolveIntentInferenceTimeoutMs(): number {
  const raw = effectiveHarnessEnvRaw("AGENT_INTENT_INFERENCE_TIMEOUT_MS")?.trim();
  const n = raw ? Number(raw) : 4000;
  if (!Number.isFinite(n) || n <= 0) return 4000;
  return Math.max(1000, Math.min(30000, n));
}

function resolveIntentConfidenceThreshold(): number {
  const raw = effectiveHarnessEnvRaw("AGENT_INTENT_CONFIDENCE_MIN")?.trim();
  const n = raw ? Number(raw) : 0.65;
  if (!Number.isFinite(n)) return 0.65;
  return Math.max(0.4, Math.min(0.95, n));
}

export function isIntentInferenceEnabled(): boolean {
  return effectiveHarnessEnvRaw("AGENT_INTENT_INFERENCE") !== "0";
}

/** Regex signals the harness derives locally (kept out of the LLM prompt for speed). */
export function deriveMessagePolicySignals(userMessage: string): {
  identityQuery: boolean;
  identityProvision: boolean;
  personaIdentityPrompt: boolean;
  runtimeIdentityPrompt: boolean;
  deckIntent: boolean;
  runtimePreferenceIntent: boolean;
  runtimeSettingsQuery: boolean;
  regexBuildDeliverable: boolean;
  regexImplementShip: boolean;
  regexFreshnessSensitive: boolean;
  regexWorkflowSuitable: boolean;
} {
  const msg = userMessage.trim();
  const lower = msg.toLowerCase();
  const identityQuery =
    /\b(what(?:'s| is) my name|do you (know|remember) my name|who am i|what do you call me|what should i call myself)\b/i.test(
      msg
    );
  const identityProvision =
    !identityQuery &&
    /\b(i'?m |i am |call me |my name is |you can call me )\b/i.test(msg);
  const personaIdentityPrompt =
    /\b(who are you|describe yourself|your persona|in character|how do you present yourself)\b/i.test(
      lower
    );
  const runtimeIdentityPrompt =
    /\b(which model|what model|openrouter|provider slug|api key|what llm|inference stack)\b/i.test(
      lower
    );
  const deckIntent = /\b(slide deck|slideshow|powerpoint|pptx|presentation deck|pitch deck)\b/i.test(
    lower
  );
  const runtimePreferenceIntent =
    /\b(change (your )?tone|be more (formal|casual|funny)|persona dial|humor level|formality)\b/i.test(
      lower
    );
  const runtimeSettingsQuery =
    /\b(current (runtime )?settings|current persona|what are my settings|read (runtime )?settings)\b/i.test(
      lower
    );
  return {
    identityQuery,
    identityProvision,
    personaIdentityPrompt,
    runtimeIdentityPrompt,
    deckIntent,
    runtimePreferenceIntent,
    runtimeSettingsQuery,
    regexBuildDeliverable: isBuildDeliverableUserMessage(msg),
    regexImplementShip: isImplementShipUserMessage(msg),
    regexFreshnessSensitive: isResearchFreshnessUserMessage(msg),
    regexWorkflowSuitable: detectWorkflowSignal(msg).match,
  };
}

/**
 * Fill policy booleans + reasoning budget after the compact classifier returns
 * intent/complexity only. Keeps the fast-model call small and off the hot path.
 */
export function enrichTurnInferenceFromMessage(
  userMessage: string,
  inference: TurnInferenceResult,
  parsed?: Record<string, unknown>
): TurnInferenceResult {
  const msg = userMessage.trim();
  const signals = deriveMessagePolicySignals(msg);
  const trustLlm = inference.source === "llm";

  let intent = inference.intent;
  if (signals.identityQuery || signals.personaIdentityPrompt || signals.runtimeIdentityPrompt) {
    intent = "conversational";
  }

  const complexity =
    intent === "conversational" ? "trivial" : inference.complexity;

  let exploratoryCreative =
    intent === "conversational" || signals.identityQuery
      ? false
      : trustLlm
        ? Boolean(parsed?.["exploratoryCreative"])
        : inference.exploratoryCreative;

  let visionIntent =
    intent === "conversational"
      ? false
      : trustLlm
        ? Boolean(parsed?.["visionIntent"])
        : inference.visionIntent;

  let workflowSuitable =
    intent === "conversational"
      ? false
      : trustLlm
        ? Boolean(parsed?.["workflowSuitable"])
        : signals.regexWorkflowSuitable;

  let buildDeliverable = signals.regexBuildDeliverable;
  let implementShip = signals.regexImplementShip;
  let freshnessSensitive = signals.regexFreshnessSensitive;

  if (trustLlm) {
    if (intent === "research") {
      freshnessSensitive = true;
      if (!implementShip) buildDeliverable = false;
    } else if (intent === "coding" || intent === "execution") {
      buildDeliverable = true;
    } else if (intent === "knowledge" || intent === "introspection") {
      if (!signals.regexImplementShip) buildDeliverable = false;
    }
    if (intent === "conversational") {
      buildDeliverable = false;
      implementShip = false;
      freshnessSensitive = false;
    }
  }

  if (intent === "conversational") {
    buildDeliverable = false;
    implementShip = false;
  }

  const budgetFromLlm =
    trustLlm && parsed ? parseReasoningBudgetFromParsed(parsed) : {};
  const fb = fallbackReasoningBudget(intent, exploratoryCreative);
  const reasoningEffort = budgetFromLlm.reasoningEffort ?? inference.reasoningEffort ?? fb.reasoningEffort;
  const thinkDepth = budgetFromLlm.thinkDepth ?? inference.thinkDepth ?? fb.thinkDepth;
  const toolFirstBias = budgetFromLlm.toolFirstBias ?? inference.toolFirstBias ?? fb.toolFirstBias;
  const reasoningWordBudget =
    budgetFromLlm.reasoningWordBudget ?? inference.reasoningWordBudget ?? fb.reasoningWordBudget;
  const essayRisk = budgetFromLlm.essayRisk ?? inference.essayRisk ?? fb.essayRisk;

  const skipHarnessSecondaryPasses =
    intent === "conversational" ||
    signals.personaIdentityPrompt ||
    signals.identityQuery ||
    Boolean(parsed?.["skipHarnessSecondaryPasses"]);

  return {
    ...inference,
    intent,
    complexity,
    likelyEditPaths: intent === "conversational" ? [] : inference.likelyEditPaths,
    stancePrompt: signals.identityQuery ? false : exploratoryCreative,
    overInferenceRisk: /\b(you (always|never)|why do you think i|you assume)\b/i.test(msg),
    exploratoryCreative,
    identityQuery: signals.identityQuery,
    identityProvision: signals.identityProvision,
    personaIdentityPrompt: signals.personaIdentityPrompt,
    runtimeIdentityPrompt: signals.runtimeIdentityPrompt,
    deckIntent: signals.deckIntent,
    freshnessSensitive,
    visionIntent,
    buildDeliverable,
    implementShip,
    runtimePreferenceIntent: signals.runtimePreferenceIntent,
    runtimeSettingsQuery: signals.runtimeSettingsQuery,
    skipHarnessSecondaryPasses,
    workflowSuitable,
    reasoningEffort,
    thinkDepth,
    toolFirstBias,
    reasoningWordBudget,
    essayRisk,
    reasoningBudgetSource: trustLlm && Object.keys(budgetFromLlm).length > 0 ? "llm" : "fallback",
  };
}

function buildInferenceFromParsed(
  parsed: Record<string, unknown>,
  confidence: number,
  source: "llm" | "default",
  reason: string,
  fallbackReason?: string
): TurnInferenceResult {
  const intentRaw = parseIntent(parsed["intent"]);
  const intent: TurnIntentClass = intentRaw ?? "knowledge";
  const complexity: TurnComplexity =
    intent === "conversational"
      ? "trivial"
      : parseComplexity(parsed["complexity"]) ?? "normal";

  const likelyEditPaths =
    intent === "conversational" ? [] : parseLikelyEditPathsField(parsed["likelyEditPaths"]);

  const fb = fallbackReasoningBudget(intent, Boolean(parsed["exploratoryCreative"]));

  return {
    intent,
    complexity,
    likelyEditPaths,
    stancePrompt: false,
    overInferenceRisk: false,
    exploratoryCreative: Boolean(parsed["exploratoryCreative"]),
    identityQuery: false,
    identityProvision: false,
    personaIdentityPrompt: false,
    runtimeIdentityPrompt: false,
    deckIntent: false,
    freshnessSensitive: false,
    visionIntent: Boolean(parsed["visionIntent"]),
    buildDeliverable: false,
    implementShip: false,
    runtimePreferenceIntent: false,
    runtimeSettingsQuery: false,
    skipHarnessSecondaryPasses: false,
    workflowSuitable: Boolean(parsed["workflowSuitable"]),
    confidence,
    source,
    reason,
    fallbackReason,
    reasoningEffort: fb.reasoningEffort,
    thinkDepth: fb.thinkDepth,
    toolFirstBias: fb.toolFirstBias,
    reasoningWordBudget: fb.reasoningWordBudget,
    essayRisk: fb.essayRisk,
    reasoningBudgetSource: "fallback",
  };
}

/** Compact classifier prompt — policy flags are derived locally in {@link enrichTurnInferenceFromMessage}. */
export const INFERENCE_SYSTEM_PROMPT =
  "Classify the user turn for harness routing. Return JSON only: " +
  "{intent,complexity,likelyEditPaths,exploratoryCreative,visionIntent,workflowSuitable,confidence,reason}. " +
  "intent: introspection|knowledge|research|coding|execution|conversational|creative. " +
  "complexity: trivial|normal|complex (orthogonal to intent). " +
  "likelyEditPaths: up to 8 repo-relative paths if coding/execution else []. " +
  "exploratoryCreative: open hypotheticals about the user's work (not pure creative writing). " +
  "visionIntent: user wants image/screenshot/diagram/chart analyzed or OCR'd. " +
  "workflowSuitable: task fans out into many independent parallel sub-tasks (codebase-wide audit, large migration, multi-angle research). " +
  "Rules: conversational=greetings/thanks/short acks/persona or identity chat; " +
  "research=needs live web sources; coding=file edits OR runnable artifacts (apps/pages/games) even if subject sounds creative; " +
  "creative=prose IS the deliverable (story/poem/copy) with no file output; " +
  "coding beats creative when the user would open a file/app after the turn.";

const HEURISTIC_GREETING_RE =
  /^(hi|hello|hey|yo|sup|howdy|greetings?|good\s+(morning|afternoon|evening|night)|evening|morning|afternoon)\b/i;
const HEURISTIC_THANKS_RE = /^(thanks|thank you|thx|ty|cheers)\b/i;
const HEURISTIC_CHITCHAT_RE = /^(how\s+are\s+you|what'?s\s+up|how\s+goes\s+it)\b/i;
const HEURISTIC_ACK_RE =
  /^(yes|yep|yeah|ok|okay|sure|go ahead|do it|continue|keep going|sounds good|perfect|great)\b/i;
const HEURISTIC_FILE_PATH_RE =
  /(?:^|\s)(?:[\w@.-]+\/)+[\w.-]+\.(?:tsx?|jsx?|py|rs|go|md|dart|json)\b/i;

/**
 * Skip the fast-model classifier for obvious short greetings/chitchat — saves several
 * seconds on the first user message while the main model is still cold.
 */
export function tryHeuristicTurnInference(userMessage: string): TurnInferenceResult | null {
  const msg = userMessage.trim();
  if (!msg) return null;

  if (isResearchFreshnessUserMessage(msg) && msg.length < 280) {
    const fb = fallbackReasoningBudget("research", false);
    return applyTurnInferenceHeuristics(
      userMessage,
      neutralTurnInferenceResult("heuristic_research_freshness", {
        intent: "research",
        complexity: msg.length < 80 ? "normal" : "normal",
        confidence: 0.88,
        freshnessSensitive: true,
        toolFirstBias: true,
        thinkDepth: "brief",
        reasoningWordBudget: 140,
        reasoningEffort: fb.reasoningEffort,
        essayRisk: false,
        reasoningBudgetSource: "fallback",
      })
    );
  }

  if (HEURISTIC_FILE_PATH_RE.test(msg) && msg.length < 220) {
    const fb = fallbackReasoningBudget("coding", false);
    return applyTurnInferenceHeuristics(
      userMessage,
      neutralTurnInferenceResult("heuristic_coding_path", {
        intent: "coding",
        complexity: "trivial",
        confidence: 0.86,
        buildDeliverable: false,
        toolFirstBias: true,
        thinkDepth: fb.thinkDepth,
        reasoningEffort: fb.reasoningEffort,
        reasoningBudgetSource: "fallback",
      })
    );
  }

  if (msg.length > 160) return null;
  const words = msg.split(/\s+/).filter(Boolean);
  if (words.length > 14) return null;
  const lower = msg.toLowerCase();
  const looksConversational =
    HEURISTIC_GREETING_RE.test(lower) ||
    HEURISTIC_THANKS_RE.test(lower) ||
    HEURISTIC_CHITCHAT_RE.test(lower) ||
    HEURISTIC_ACK_RE.test(lower);
  if (!looksConversational) return null;
  if (
    /\b(fix|implement|build|write|debug|refactor|create|add|remove|delete|search|grep|file|code)\b/i.test(
      lower
    )
  ) {
    return null;
  }
  const fb = fallbackReasoningBudget("conversational", false);
  return applyTurnInferenceHeuristics(
    userMessage,
    neutralTurnInferenceResult("heuristic_conversational", {
      intent: "conversational",
      complexity: "trivial",
      confidence: 0.9,
      skipHarnessSecondaryPasses: true,
      reasoningEffort: fb.reasoningEffort,
      thinkDepth: fb.thinkDepth,
      toolFirstBias: fb.toolFirstBias,
      reasoningWordBudget: fb.reasoningWordBudget,
      essayRisk: fb.essayRisk,
      reasoningBudgetSource: "fallback",
    })
  );
}

/** Env gate — heuristic conversational fast path (skips heavy preflight, keeps LLM for other turns). */
export function isConversationalFastPathEnabled(): boolean {
  return effectiveHarnessEnvRaw("AGENT_CONVERSATIONAL_FAST_PATH") !== "0";
}

/**
 * True only for high-confidence heuristic greetings/chitchat — never for LLM-classified turns.
 * Used to skip world-context gather, tool manifest, and usage polling without disabling
 * the fast-model classifier on ambiguous messages.
 */
export function isHeuristicConversationalFastPath(
  userMessage: string,
  inference?: TurnInferenceResult | null
): boolean {
  if (!isConversationalFastPathEnabled()) return false;
  const inf = inference ?? tryHeuristicTurnInference(userMessage);
  if (!inf) return false;
  return (
    inf.reason === "heuristic_conversational" &&
    inf.intent === "conversational" &&
    inf.complexity === "trivial" &&
    (inf.confidence ?? 0) >= 0.85 &&
    !inf.identityQuery &&
    !inf.runtimeIdentityPrompt &&
    !inf.personaIdentityPrompt
  );
}

export async function inferTurnInference(
  client: OpenAI,
  model: string,
  userMessage: string,
  workspace?: IntentInferenceWorkspaceContext
): Promise<TurnInferenceResult> {
  if (!isIntentInferenceEnabled()) {
    return applyTurnInferenceHeuristics(
      userMessage,
      neutralTurnInferenceResult("intent_inference_disabled", {
        fallbackReason: "AGENT_INTENT_INFERENCE=0",
        confidence: 0.51,
      })
    );
  }

  const heuristic = tryHeuristicTurnInference(userMessage);
  if (heuristic) return heuristic;

  const userContent = buildIntentInferenceUserContent(userMessage, workspace);

  // Hard-cap the classification call. If the fast model stalls, fall back to
  // the neutral result immediately rather than blocking the whole turn.
  const jr = await completeChatJson(client, {
    model: getFastModelSlug(model),
    messages: [
      { role: "system", content: INFERENCE_SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
    maxTokens: 240,
    temperature: 0,
    signal: AbortSignal.timeout(resolveIntentInferenceTimeoutMs()),
  });

  if (!jr.ok || typeof jr.parsed !== "object" || jr.parsed == null) {
    return applyTurnInferenceHeuristics(
      userMessage,
      neutralTurnInferenceResult("llm_inference_failed", {
        fallbackReason: jr.ok ? "invalid_json_shape" : jr.error,
      })
    );
  }

  const parsed = jr.parsed as Record<string, unknown>;
  const confidenceRaw = Number(parsed["confidence"] ?? 0.5);
  const confidence = Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(1, confidenceRaw)) : 0.5;
  const threshold = resolveIntentConfidenceThreshold();

  const reasonStr =
    typeof parsed["reason"] === "string" ? parsed["reason"].slice(0, 200) : "classified_by_llm";

  if (confidence < threshold) {
    const base = enrichTurnInferenceFromMessage(
      userMessage,
      buildInferenceFromParsed(parsed, confidence, "llm", reasonStr),
      parsed
    );
    const withFb = applyFallbackReasoningFields(
      {
        ...base,
        fallbackReason: `confidence=${confidence.toFixed(2)} < threshold=${threshold.toFixed(2)}`,
      },
      false
    );
    return applyTurnInferenceHeuristics(userMessage, withFb);
  }

  const result = enrichTurnInferenceFromMessage(
    userMessage,
    buildInferenceFromParsed(parsed, confidence, "llm", reasonStr),
    parsed
  );
  return applyTurnInferenceHeuristics(userMessage, applyFallbackReasoningFields(result, true));
}

/**
 * Apply policy overrides on top of the classifier output.
 *
 * The three signals — research-freshness, build-deliverable, implement-ship —
 * are predicted directly by the fast-model classifier (see INFERENCE_SYSTEM_PROMPT).
 * Trust those typed predictions when they come from a high-confidence LLM call;
 * fall back to the regex heuristics in {@link reasoning_surface} only when the
 * classifier was off, errored, or returned source !== "llm" (the historical safety
 * net for low-confidence turns).
 *
 * Why this split: the fast model handles paraphrase and intent way better than a
 * keyword regex ("spin up a Socratic dashboard for me" / "prototype something cool"
 * never matched the old regex). The regex stays for the offline / failure path so
 * the harness still degrades gracefully when the classifier call is unavailable.
 */
export function applyTurnInferenceHeuristics(
  userMessage: string,
  inference: TurnInferenceResult
): TurnInferenceResult {
  const msg = userMessage.trim();
  if (!msg) return inference;

  const trustLlm = inference.source === "llm";

  const researchFresh = trustLlm
    ? inference.freshnessSensitive === true
    : inference.freshnessSensitive === true || isResearchFreshnessUserMessage(msg);
  const buildDeliverable = trustLlm
    ? inference.buildDeliverable === true
    : isBuildDeliverableUserMessage(msg);
  const implementShip = trustLlm
    ? inference.implementShip === true
    : isImplementShipUserMessage(msg);

  if (researchFresh && !implementShip && !buildDeliverable) {
    const wordBudget = Math.min(inference.reasoningWordBudget ?? 350, 140);
    return {
      ...inference,
      intent: "research",
      exploratoryCreative: false,
      freshnessSensitive: true,
      toolFirstBias: true,
      thinkDepth: "brief",
      reasoningWordBudget: wordBudget,
      essayRisk: false,
      reason: `${inference.reason ?? ""} heuristic=research_freshness`.trim(),
    };
  }

  if (buildDeliverable || implementShip) {
    const wordBudget = Math.min(inference.reasoningWordBudget ?? 350, 130);
    return {
      ...inference,
      intent: implementShip ? "coding" : inference.intent === "execution" ? "execution" : "coding",
      // "build me a Socratic browser OS" is a coding task with a creative
      // *subject* — the deliverable still lives on disk. Force complexity to at
      // least normal so the routing profile allocates a coding-grade token cap
      // instead of a tiny knowledge-grade one (which silently throttles big
      // single-shot HTML writes).
      complexity: inference.complexity === "trivial" ? "normal" : inference.complexity,
      exploratoryCreative: false,
      toolFirstBias: true,
      thinkDepth: "brief",
      reasoningWordBudget: wordBudget,
      // essayRisk is critical here: it tells downstream guards that this turn
      // tempts long narration before tools. True whenever buildDeliverable
      // OR implementShip fires.
      essayRisk: true,
      reason: `${inference.reason ?? ""} heuristic=build_deliverable`.trim(),
    };
  }

  return inference;
}

/**
 * Cheap heuristic for the `complexity` field when the classifier is off or low
 * confidence. Used as a safety net only — the LLM classifier's prediction wins
 * when present.
 */
export function fallbackComplexityForUserMessage(userMessage: string): TurnComplexity {
  const t = userMessage.trim();
  if (t.length === 0) return "trivial";
  // Very short messages are almost always trivial.
  if (t.length < 32 && !/\n/.test(t)) return "trivial";
  // Long messages, multi-paragraph, or many list items → likely complex.
  const newlines = (t.match(/\n/g) ?? []).length;
  const bullets = (t.match(/(^|\n)\s*([-*]|\d+\.)\s+/g) ?? []).length;
  if (t.length > 1200 || newlines > 15 || bullets > 6) return "complex";
  return "normal";
}


/** Single gate for stream [CONTINUE] and finalize extension skips on conversational persona turns. */
export function shouldSkipHarnessSecondaryPassesForTurn(
  _userMessage: string,
  inference: TurnInferenceResult | null | undefined
): boolean {
  if (inference?.runtimeIdentityPrompt) return false;
  if (inference?.skipHarnessSecondaryPasses) return true;
  if (inference?.intent === "conversational") return true;
  if (inference?.personaIdentityPrompt) return true;
  if (inference?.identityQuery) return true;
  return false;
}

export function resolveMemoryPolicy(
  intent: TurnIntentClass,
  opts?: { identityQuery?: boolean; exploratoryCreative?: boolean }
): MemoryPolicy {
  if (opts?.identityQuery === true) {
    return {
      allowAutoRecall: true,
      scope: "both",
      maxAgeDays: 3650,
      minConfidence: 0.1,
      minQueryOverlap: 0.02,
    };
  }
  // Creative generation: never let stored facts/recipes/trajectories pollute
  // ideation. If the user wants memory-grounded writing they'll ask explicitly.
  if (intent === "creative") {
    return {
      allowAutoRecall: false,
      scope: "notes",
      maxAgeDays: 365,
      minConfidence: 0.55,
      minQueryOverlap: 0.25,
      excludeTypes: ["trajectory", "recipe", "fact"],
    };
  }
  // Conversational: no auto-recall — chitchat shouldn't drag in stored project state.
  // Identity-query carve-out above already handled the "do you know my name" case.
  if (intent === "conversational") {
    return {
      allowAutoRecall: false,
      scope: "notes",
      maxAgeDays: 180,
      minConfidence: 0.5,
      minQueryOverlap: 0.2,
    };
  }
  const debiasOn = effectiveHarnessEnvRaw("AGENT_MEMORY_DEBIAS") !== "0";
    if (!debiasOn && opts?.exploratoryCreative !== true) {
      return { allowAutoRecall: true, scope: "both" };
    }
    const maxAgeDefault = Math.max(
      7,
      Math.min(3650, parseInt(effectiveHarnessEnvRaw("AGENT_MEMORY_MAX_AGE_DAYS_DEFAULT") ?? "540", 10) || 540)
    );
    const minConfDefault = Math.max(
      0,
      Math.min(1, Number(effectiveHarnessEnvRaw("AGENT_MEMORY_MIN_CONFIDENCE_DEFAULT") ?? "0.35") || 0.35)
    );
    // Default is memory-first for introspection too; opt into stricter filtering explicitly.
    const strictIntro = effectiveHarnessEnvRaw("AGENT_MEMORY_INTROSPECTION_STRICT") === "1";
    if (intent === "introspection" && strictIntro) {
      return {
        allowAutoRecall: false,
        scope: "notes",
        maxAgeDays: Math.min(maxAgeDefault, 120),
        minConfidence: Math.max(minConfDefault, 0.55),
        minQueryOverlap: 0.18,
        excludeTypes: ["fact"],
      };
    }
    if (opts?.exploratoryCreative === true) {
      if (effectiveHarnessEnvRaw("AGENT_MEMORY_EXPLORATORY_AUTO_RECALL") === "1") {
        return {
          allowAutoRecall: true,
          scope: "notes",
          maxAgeDays: Math.min(maxAgeDefault, 90),
          minConfidence: Math.max(minConfDefault, 0.55),
          minQueryOverlap: 0.22,
          excludeTypes: ["trajectory", "recipe"],
        };
      }
      return {
        allowAutoRecall: false,
        scope: "both",
        maxAgeDays: maxAgeDefault,
        minConfidence: minConfDefault,
        minQueryOverlap: 0.2,
      };
    }
    if (!debiasOn) {
      return { allowAutoRecall: true, scope: "both" };
    }
  if (intent === "knowledge" || intent === "research") {
    return {
      allowAutoRecall: true,
      scope: "both",
      maxAgeDays: maxAgeDefault,
      minConfidence: minConfDefault,
      minQueryOverlap: 0.08,
    };
  }
  return {
    allowAutoRecall: false,
    scope: "notes",
    maxAgeDays: Math.min(maxAgeDefault, 180),
    minConfidence: Math.max(minConfDefault, 0.45),
    minQueryOverlap: 0.12,
  };
}

export function isOverInferenceLlmCheckEnabled(): boolean {
  return effectiveHarnessEnvRaw("AGENT_OVERINFERENCE_LLM_CHECK") !== "0";
}

export async function evaluateOverInferenceSemantics(
  client: OpenAI,
  model: string,
  userMessage: string,
  assistantText: string
): Promise<OverInferenceSemanticResult> {
  if (!isOverInferenceLlmCheckEnabled()) {
    return { passed: true, reason: "semantic_check_disabled", confidence: 0.5, source: "heuristic" };
  }
  const jr = await completeChatJson(client, {
    model: getFastModelSlug(model),
    messages: [
      {
        role: "system",
        content:
          "Judge over-inference risk in assistant readback. Return JSON only: " +
          "{passed:boolean,reason:string,confidence:number,fix_hint?:string}. " +
          "Fail when assistant treats user questions/probes as confirmed beliefs without caveats.",
      },
      {
        role: "user",
        content:
          `User prompt:\n${userMessage.slice(0, 1600)}\n\n` +
          `Assistant draft:\n${assistantText.slice(0, 4000)}`,
      },
    ],
    maxTokens: 220,
    temperature: 0,
  });
  if (!jr.ok || typeof jr.parsed !== "object" || jr.parsed == null) {
    return {
      passed: true,
      reason: "semantic_check_failed_open",
      confidence: 0.4,
      source: "heuristic",
    };
  }
  const parsed = jr.parsed as Record<string, unknown>;
  const confidenceRaw = Number(parsed["confidence"] ?? 0.5);
  const confidence = Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(1, confidenceRaw)) : 0.5;
  return {
    passed: Boolean(parsed["passed"]),
    reason: typeof parsed["reason"] === "string" ? parsed["reason"].slice(0, 200) : "semantic_check_complete",
    confidence,
    source: "llm",
    fixHint: typeof parsed["fix_hint"] === "string" ? parsed["fix_hint"].slice(0, 220) : undefined,
  };
}
