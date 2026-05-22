import OpenAI from "openai";
import { completeChatJson, getFastModelSlug } from "./router.js";
import { effectiveHarnessEnvRaw } from "./harness_effective_env.js";
import {
  applyFallbackReasoningFields,
  fallbackReasoningBudget,
  parseReasoningBudgetFromParsed,
  type ReasoningEffort,
  type ThinkDepth,
} from "./reasoning_profile.js";
import {
  isBuildDeliverableUserMessage,
  isImplementShipUserMessage,
  isResearchFreshnessUserMessage,
} from "./reasoning_surface.js";

export type TurnIntentClass = "introspection" | "knowledge" | "research" | "coding" | "execution" | "operational";

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
  operational: (n) =>
    n === "read_file" || n === "write_file" || n === "edit_file" || n === "list_dir" ||
    n === "run_shell" || n === "grep_file" || n === "think" || n === "plan",
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
  /** Where intent came from: "llm" | "heuristic" | "default" | "fallback" | etc. */
  source: string;
  /** Confidence score [0–1] from intent classification. */
  confidence: number;
  /** Whether a tool name filter is active (limits the tool surface for this turn). */
  toolFilterActive: boolean;
}

function resolveIntentFastThreshold(): number {
  const n = Number(effectiveHarnessEnvRaw("AGENT_INTENT_FAST_THRESHOLD") ?? "0.8");
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.8;
}

function resolveIntentOperationalModel(mainModel: string): string {
  return effectiveHarnessEnvRaw("AGENT_INTENT_OPERATIONAL_MODEL")?.trim() ||
    effectiveHarnessEnvRaw("AGENT_FAST_MODEL")?.trim() ||
    mainModel;
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
    source: inference?.source ?? "default",
    confidence: inference?.confidence ?? 0,
    toolFilterActive: false,
  };

  if (effectiveHarnessEnvRaw("AGENT_INTENT_ROUTING") !== "1") return noOp;
  if (!inference) return noOp;

  const threshold = resolveIntentFastThreshold();
  const confidence = inference.confidence ?? 0;
  const intent = inference.intent;

  // Only route away from main model if confidence is high enough
  let modelSlug = mainModel;
  let maxTokens = 0;

  if (intent === "introspection") {
    if (confidence >= threshold) {
      modelSlug = effectiveHarnessEnvRaw("AGENT_FAST_MODEL")?.trim() || mainModel;
      maxTokens = 2048;
    }
  } else if (intent === "operational") {
    modelSlug = resolveIntentOperationalModel(mainModel);
    maxTokens = 1024;
  } else if (intent === "knowledge") {
    maxTokens = 4096;
  } else if (intent === "research") {
    maxTokens = 8192;
  } else if (intent === "coding") {
    maxTokens = 8192;
  } else if (intent === "execution") {
    maxTokens = 6144;
  }

  // Only apply tool filters for high-confidence LLM classifications.
  // Fallback/default inferences always see all tools — don't silently strip
  // shell/git/code from messages the classifier wasn't confident about.
  const applyToolFilter = inference.source === "llm" && confidence >= threshold;
  const toolFilter = applyToolFilter ? (ROUTING_TOOL_FILTERS[intent] ?? null) : null;

  return {
    modelSlug,
    toolFilter,
    maxTokens,
    applied: modelSlug !== mainModel || maxTokens > 0,
    intent,
    source: inference.source ?? "default",
    confidence: inference.confidence ?? 0,
    toolFilterActive: toolFilter !== null,
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
  /** User asks for assistant persona/identity ("who are you", "your persona"). */
  personaIdentityPrompt: boolean;
  /** User explicitly asks model/runtime/provider details. */
  runtimeIdentityPrompt: boolean;
  /** User wants a presentation, slide deck, or similar visual document. */
  deckIntent: boolean;
  /** User needs current, live, or recent information. */
  freshnessSensitive: boolean;
  /**
   * User is asking to change runtime preferences (especially persona controls).
   * Route via explicit runtime tools (set_runtime_settings / set_persona), not memory tools.
   */
  runtimePreferenceIntent: boolean;
  /** User asks to read/check current runtime or persona control values. */
  runtimeSettingsQuery: boolean;
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
    likelyEditPaths: [],
    stancePrompt: false,
    overInferenceRisk: false,
    exploratoryCreative,
    identityQuery: false,
    personaIdentityPrompt: false,
    runtimeIdentityPrompt: false,
    deckIntent: false,
    freshnessSensitive: false,
    runtimePreferenceIntent: false,
    runtimeSettingsQuery: false,
    skipHarnessSecondaryPasses: false,
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

function parseIntent(value: unknown): TurnIntentClass | null {
  if (
    value === "introspection" || value === "knowledge" || value === "research" ||
    value === "coding" || value === "execution" || value === "operational"
  ) {
    return value;
  }
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
  const n = raw ? Number(raw) : 8000;
  if (!Number.isFinite(n) || n <= 0) return 8000;
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

function buildInferenceFromParsed(
  parsed: Record<string, unknown>,
  confidence: number,
  source: "llm" | "default",
  reason: string,
  fallbackReason?: string
): TurnInferenceResult {
  const identityQuery = Boolean(parsed["identityQuery"]);
  const intentRaw = parseIntent(parsed["intent"]);
  const intent: TurnIntentClass = identityQuery ? "knowledge" : intentRaw ?? "knowledge";
  const likelyEditPaths = identityQuery ? [] : parseLikelyEditPathsField(parsed["likelyEditPaths"]);

  const budgetFields = parseReasoningBudgetFromParsed(parsed);

  return {
    intent,
    likelyEditPaths,
    stancePrompt: identityQuery ? false : Boolean(parsed["stancePrompt"]),
    overInferenceRisk: identityQuery ? false : Boolean(parsed["overInferenceRisk"]),
    exploratoryCreative: identityQuery ? false : Boolean(parsed["exploratoryCreative"]),
    identityQuery,
    personaIdentityPrompt: Boolean(parsed["personaIdentityPrompt"]),
    runtimeIdentityPrompt: Boolean(parsed["runtimeIdentityPrompt"]),
    deckIntent: Boolean(parsed["deckIntent"]),
    freshnessSensitive: Boolean(parsed["freshnessSensitive"]),
    runtimePreferenceIntent: Boolean(parsed["runtimePreferenceIntent"]),
    runtimeSettingsQuery: Boolean(parsed["runtimeSettingsQuery"]),
    skipHarnessSecondaryPasses: Boolean(parsed["skipHarnessSecondaryPasses"]),
    confidence,
    source,
    reason,
    fallbackReason,
    ...budgetFields,
  };
}

const INFERENCE_SYSTEM_PROMPT =
  "Classify the user message for harness policy. Return JSON only with exactly these keys: " +
  "{intent:'introspection|knowledge|research|coding|execution|operational',likelyEditPaths:string[],stancePrompt:boolean,overInferenceRisk:boolean," +
  "exploratoryCreative:boolean,identityQuery:boolean,personaIdentityPrompt:boolean,runtimeIdentityPrompt:boolean,deckIntent:boolean," +
  "freshnessSensitive:boolean,runtimePreferenceIntent:boolean,runtimeSettingsQuery:boolean,skipHarnessSecondaryPasses:boolean," +
  "reasoningEffort:'none'|'low'|'medium'|'high'|'xhigh',thinkDepth:'skip'|'brief'|'standard'|'deep',toolFirstBias:boolean," +
  "reasoningWordBudget:number,essayRisk:boolean,confidence:number,reason:string}. " +
  "REASONING BUDGET (defaults when uncertain: reasoningEffort=high; thinkDepth=standard for knowledge/research/coding/execution): " +
  "reasoningEffort=none only for trivial one-liners (hi/thanks/yes/no). " +
  "toolFirstBias=true when user wants implement/run/test/show results/ship code now — even for hard-sounding tasks. " +
  "Lower reasoningWordBudget (80-200) when toolFirstBias=true; use brief thinkDepth. " +
  "essayRisk=true when task invites long design essays before tools (novel algorithms + implement, zero-shot challenges). " +
  "thinkDepth=deep only for open ideation without a clear ship-now clause. " +
  "Examples: 'write hello.py and run' → coding, high, brief, toolFirst true, budget ~120. " +
  "'zero-shot implement TSP algorithm in Python and test' → coding, high, brief, toolFirst true, budget ~180, essayRisk true. " +
  "'explain quantum computing' → knowledge, high, standard, toolFirst false, budget ~350. " +
  "likelyEditPaths: up to 8 repo-relative file/dir paths the user will most likely need to read or edit for this turn, " +
  "inferred from USER_MESSAGE plus any RECENT_FILES_* / REPO_TREE / LAST_ASSISTANT sections; use [] when not a coding task or nothing fits. " +
  "exploratoryCreative=true when the user mainly wants open-ended ideation, hypotheticals, or creative futures " +
  "(e.g. 'if you could build one thing', 'what would make universal high income more likely', 'blue sky ideas', " +
  "'imagine…', 'thought experiment', 'ignore my roadmap for a moment') rather than executing or optimizing an existing stored plan. " +
  "false when they want concrete edits, repo work, research on a specified topic, or explicit review of their roadmap/business files. " +
  "identityQuery=true when the user asks about THEIR name, what to call them, who they are, or whether you know/remember their name. " +
  "personaIdentityPrompt=true when they ask for YOUR persona/identity (who you are in character, describe yourself, your personality) — " +
  "including casual 'who are you' to the assistant when they want a persona answer, not a vendor stack dump. " +
  "runtimeIdentityPrompt=true ONLY when they explicitly want base LLM/provider/model slug/API/stack facts " +
  "(e.g. which model, which provider, OpenRouter slug). If ambiguous, set runtimeIdentityPrompt=false. " +
  "skipHarnessSecondaryPasses=true when the message is mainly a short opener for assistant self-intro, persona surface, or compact " +
  "capabilities overview (who you are / what you can do as an intro) without a substantive multi-step task; false when they want real work, " +
  "research, code, edits, or long-form deliverables. " +
  "deckIntent=true for presentations, slides, decks, slideshows. " +
  "freshnessSensitive=true when they need current/live/recent/up-to-date information. " +
  "runtimePreferenceIntent=true when the user asks to change runtime behavior/settings/preferences, especially persona controls " +
  "(humor, formality, confidence, verbosity, persona strength, tone/style dials). " +
  "runtimeSettingsQuery=true when user asks to check/read current runtime settings or current persona controls " +
  "(e.g., 'what is my humor setting now?', 'check runtime settings'). " +
  "overInferenceRisk=true when the request invites speculative user-belief attribution. " +
  "confidence is 0–1 for your overall classification certainty. " +
  "intent classes: introspection=memory queries, capability checks, self-reflection; " +
  "knowledge=background Q&A, explanations, factual recall without live web sources; " +
  "research=live multi-source investigation using web_search/web_fetch — news, markets, current events, fact-checking; " +
  "coding=code edits, repo work, debugging, refactoring, tests; " +
  "execution=builds, deploys, CI/CD, process runs, tool-heavy pipelines; " +
  "operational=scheduled briefs, structured analysis, file-system maintenance, no narrative output needed.";

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

  const userContent = buildIntentInferenceUserContent(userMessage, workspace);

  // Hard-cap the classification call. If the fast model stalls, fall back to
  // the neutral result immediately rather than blocking the whole turn.
  const jr = await completeChatJson(client, {
    model: getFastModelSlug(model),
    messages: [
      { role: "system", content: INFERENCE_SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
    maxTokens: 420,
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
    const base = buildInferenceFromParsed(parsed, confidence, "llm", reasonStr);
    const withFb = applyFallbackReasoningFields(
      {
        ...base,
        fallbackReason: `confidence=${confidence.toFixed(2)} < threshold=${threshold.toFixed(2)}`,
      },
      false
    );
    return applyTurnInferenceHeuristics(userMessage, withFb);
  }

  const result = buildInferenceFromParsed(parsed, confidence, "llm", reasonStr);
  return applyTurnInferenceHeuristics(userMessage, applyFallbackReasoningFields(result, true));
}

/**
 * Regex safety net when the fast classifier misses research/build turns or marks them exploratory.
 * Forces tool-first budgets so the model calls web_search / write_file instead of long native reasoning.
 */
export function applyTurnInferenceHeuristics(
  userMessage: string,
  inference: TurnInferenceResult
): TurnInferenceResult {
  const msg = userMessage.trim();
  if (!msg) return inference;

  const researchFresh =
    inference.freshnessSensitive === true || isResearchFreshnessUserMessage(msg);
  const buildDeliverable = isBuildDeliverableUserMessage(msg);
  const implementShip = isImplementShipUserMessage(msg);

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

  if (buildDeliverable || (implementShip && inference.intent !== "operational")) {
    const wordBudget = Math.min(inference.reasoningWordBudget ?? 350, 130);
    return {
      ...inference,
      intent: implementShip ? "coding" : inference.intent === "execution" ? "execution" : "coding",
      exploratoryCreative: false,
      toolFirstBias: true,
      thinkDepth: "brief",
      reasoningWordBudget: wordBudget,
      essayRisk: inference.essayRisk || implementShip,
      reason: `${inference.reason ?? ""} heuristic=build_deliverable`.trim(),
    };
  }

  return inference;
}


/** Single gate for stream [CONTINUE] and finalize extension skips on conversational persona turns. */
export function shouldSkipHarnessSecondaryPassesForTurn(
  _userMessage: string,
  inference: TurnInferenceResult | null | undefined
): boolean {
  if (inference?.runtimeIdentityPrompt) return false;
  if (inference?.skipHarnessSecondaryPasses) return true;
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
