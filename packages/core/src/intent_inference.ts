import OpenAI from "openai";
import { completeChatJson, getFastModelSlug } from "./router.js";
import { effectiveHarnessEnvRaw } from "./harness_effective_env.js";

export type TurnIntentClass = "introspection" | "knowledge" | "coding" | "execution";

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
  source: "llm" | "default";
  reason: string;
  fallbackReason?: string;
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
  return {
    intent: "knowledge",
    likelyEditPaths: [],
    stancePrompt: false,
    overInferenceRisk: false,
    exploratoryCreative: false,
    identityQuery: false,
    personaIdentityPrompt: false,
    runtimeIdentityPrompt: false,
    deckIntent: false,
    freshnessSensitive: false,
    runtimePreferenceIntent: false,
    runtimeSettingsQuery: false,
    skipHarnessSecondaryPasses: false,
    confidence: 0.5,
    ...(extra ?? {}),
    source: "default",
    reason,
  };
}

function parseIntent(value: unknown): TurnIntentClass | null {
  if (value === "introspection" || value === "knowledge" || value === "coding" || value === "execution") {
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
  };
}

const INFERENCE_SYSTEM_PROMPT =
  "Classify the user message for harness policy. Return JSON only with exactly these keys: " +
  "{intent:'introspection|knowledge|coding|execution',likelyEditPaths:string[],stancePrompt:boolean,overInferenceRisk:boolean," +
  "exploratoryCreative:boolean,identityQuery:boolean,personaIdentityPrompt:boolean,runtimeIdentityPrompt:boolean,deckIntent:boolean," +
  "freshnessSensitive:boolean,runtimePreferenceIntent:boolean,runtimeSettingsQuery:boolean,skipHarnessSecondaryPasses:boolean,confidence:number,reason:string}. " +
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
  "confidence is 0–1 for your overall classification certainty.";

export async function inferTurnInference(
  client: OpenAI,
  model: string,
  userMessage: string,
  workspace?: IntentInferenceWorkspaceContext
): Promise<TurnInferenceResult> {
  if (!isIntentInferenceEnabled()) {
    return neutralTurnInferenceResult("intent_inference_disabled", {
      fallbackReason: "AGENT_INTENT_INFERENCE=0",
      confidence: 0.51,
    });
  }

  const userContent = buildIntentInferenceUserContent(userMessage, workspace);

  const jr = await completeChatJson(client, {
    model: getFastModelSlug(model),
    messages: [
      { role: "system", content: INFERENCE_SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
    maxTokens: 340,
    temperature: 0,
  });

  if (!jr.ok || typeof jr.parsed !== "object" || jr.parsed == null) {
    return neutralTurnInferenceResult("llm_inference_failed", {
      fallbackReason: jr.ok ? "invalid_json_shape" : jr.error,
    });
  }

  const parsed = jr.parsed as Record<string, unknown>;
  const confidenceRaw = Number(parsed["confidence"] ?? 0.5);
  const confidence = Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(1, confidenceRaw)) : 0.5;
  const threshold = resolveIntentConfidenceThreshold();

  const reasonStr =
    typeof parsed["reason"] === "string" ? parsed["reason"].slice(0, 200) : "classified_by_llm";

  if (confidence < threshold) {
    const base = buildInferenceFromParsed(parsed, confidence, "llm", reasonStr);
    return {
      ...base,
      fallbackReason: `confidence=${confidence.toFixed(2)} < threshold=${threshold.toFixed(2)}`,
    };
  }

  return buildInferenceFromParsed(parsed, confidence, "llm", reasonStr);
}

/**
 * Fast heuristic for exploratory / blue-sky prompts when the small-model classifier
 * is disabled, low-confidence, or misses the nuance. Kept conservative to avoid
 * firing on "build this feature in my roadmap.md".
 */
export function heuristicExploratoryCreative(userMessage: string): boolean {
  const t = userMessage.trim();
  if (t.length < 14) return false;
  const low = t.toLowerCase();
  if (/\b(use|open|update|fix|implement|edit|refactor)\b.{0,120}\b(roadmap|cashflow|plan\.md|business plan)\b/.test(low)) {
    return false;
  }
  if (
    /\bignore (my )?(roadmap|plan|notes|memory|vault)\b/.test(low) ||
    /\bblue[- ]sky\b/.test(low) ||
    /\bfresh eyes\b/.test(low) ||
    /\bwithout (using |consulting )(my )?(notes|memory|vault|roadmap)\b/.test(low)
  ) {
    return true;
  }
  if (/\bthought experiment\b/.test(low)) return true;
  if (/\b(if you could|if i could)\b.{0,100}\b(build|make|create|invent)\b/.test(low)) return true;
  if (/\bwhat (one )?thing would you (build|make|create)\b/.test(low)) return true;
  if (/\b(build|make|create) one thing\b/.test(low)) return true;
  if (/\bcreative mode\b|\bdivergent thinking\b|\b101 ideas\b/.test(low)) return true;
  if (/\b(how )?to make\b.{0,72}\b(more likely|happen sooner|feasible|realistic)\b/.test(low)) return true;
  if (/\bu(niversal)?\s*h(igh)?\s*i(ncome)?\b.{0,96}\b(more likely|accelerat|increase|feasible|realistic)\b/.test(low)) {
    return true;
  }
  if (/\bwhat if\b.{0,80}\b(world|everyone|society|economy|policy)\b/.test(low)) return true;
  return false;
}

/**
 * Persona / session-history questions (who you are, what we've been doing).
 * Used to skip [CONTINUE] stream resumes and post-answer finalize loops that glue a second reply.
 */
export function heuristicPersonaOrHistoryPrompt(userMessage: string): boolean {
  const t = userMessage.trim().toLowerCase();
  if (t.length < 10) return false;
  if (
    /\b(about yourself|tell me about yourself|describe yourself|who you are|who u are|who are you|who r u|who've you been|who you have been|who u have been)\b/.test(
      t
    )
  ) {
    return true;
  }
  if (/\b(what we have been doing|what we've been doing|our history|who you('ve| have) been)\b/.test(t)) {
    return true;
  }
  if (/\b(your persona|your identity|in character)\b/.test(t) && /\b(who|what|tell|describe|been)\b/.test(t)) {
    return true;
  }
  return false;
}

/** Single gate for stream [CONTINUE] and finalize extension skips on conversational persona turns. */
export function shouldSkipHarnessSecondaryPassesForTurn(
  userMessage: string,
  inference: TurnInferenceResult | null | undefined
): boolean {
  if (inference?.runtimeIdentityPrompt) return false;
  if (inference?.skipHarnessSecondaryPasses) return true;
  if (inference?.personaIdentityPrompt) return true;
  if (inference?.identityQuery) return true;
  if (heuristicPersonaOrHistoryPrompt(userMessage)) return true;
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
  if (intent === "knowledge") {
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
