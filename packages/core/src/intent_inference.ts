import OpenAI from "openai";
import { completeChatJson, getFastModelSlug } from "./router.js";

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
  stancePrompt: boolean;
  overInferenceRisk: boolean;
  /** User is asking about their name / who they are / what to call them. */
  identityQuery: boolean;
  /** User wants a presentation, slide deck, or similar visual document. */
  deckIntent: boolean;
  /** User needs current, live, or recent information. */
  freshnessSensitive: boolean;
  confidence: number;
  source: "llm" | "fallback_regex";
  reason: string;
  fallbackReason?: string;
}

export interface OverInferenceSemanticResult {
  passed: boolean;
  reason: string;
  confidence: number;
  source: "llm" | "heuristic";
  fixHint?: string;
}

function classifyTurnIntentFallback(text: string): TurnIntentClass {
  const t = text.toLowerCase();
  if (
    /\b(can you|what can you do|who are you|what tools|what tool|manage yourself|manage the harness|self-manage|self manage|capabilit)/.test(
      t
    )
  ) {
    return "introspection";
  }
  if (
    /\b(build|compile|typecheck|test|lint|npm run|fix bug|debug|refactor|implement|code|patch|edit|file)\b/.test(
      t
    )
  ) {
    return "coding";
  }
  if (/\b(run|execute|deploy|start|launch|restart|kill process|shell|terminal)\b/.test(t)) {
    return "execution";
  }
  return "knowledge";
}

function isUserStancePromptFallback(text: string): boolean {
  const t = text.toLowerCase();
  if (isIdentityRecallPrompt(text)) return false;
  return /\b(my opinions?|what do i think|what are my views|read me back|summari[sz]e me|my stance|about me)\b/.test(
    t
  );
}

function isIdentityRecallPrompt(text: string): boolean {
  const t = text.toLowerCase();
  return /\b(my real name|my name|what'?s my name|what is my name|do you know my name|who am i|what should you call me|call me|address me|my first name|my full name|have you stored my name|remember my name|know my name)\b/.test(
    t
  );
}

function isDeckIntentFallback(text: string): boolean {
  return /\b(deck|powerpoint|pptx|ppx|slides|slide deck|presentation|keynote|slideshow|slide show)\b/i.test(text);
}

function isFreshnessSensitiveFallback(text: string): boolean {
  return /\b(latest|current|today|recent|update|version|release|changelog|what'?s new|state of|newest|up.?to.?date|right now|live|happening now|at the moment|cutting.?edge)\b/i.test(text);
}

export function isIdentityRecallLikePrompt(text: string): boolean {
  return isIdentityRecallPrompt(text);
}

function parseIntent(value: unknown): TurnIntentClass | null {
  if (value === "introspection" || value === "knowledge" || value === "coding" || value === "execution") {
    return value;
  }
  return null;
}

function resolveIntentConfidenceThreshold(): number {
  const raw = process.env["AGENT_INTENT_CONFIDENCE_MIN"]?.trim();
  const n = raw ? Number(raw) : 0.65;
  if (!Number.isFinite(n)) return 0.65;
  return Math.max(0.4, Math.min(0.95, n));
}

export function isIntentInferenceEnabled(): boolean {
  return process.env["AGENT_INTENT_INFERENCE"] !== "0";
}

export async function inferTurnInference(
  client: OpenAI,
  model: string,
  userMessage: string
): Promise<TurnInferenceResult> {
  const fallbackIntent = classifyTurnIntentFallback(userMessage);
  const fallbackStance = isUserStancePromptFallback(userMessage);
  const fallbackIdentityQuery = isIdentityRecallPrompt(userMessage);
  const fallbackDeckIntent = isDeckIntentFallback(userMessage);
  const fallbackFreshnessSensitive = isFreshnessSensitiveFallback(userMessage);

  if (!isIntentInferenceEnabled()) {
    return {
      intent: fallbackIdentityQuery ? "knowledge" : fallbackIntent,
      stancePrompt: fallbackIdentityQuery ? false : fallbackStance,
      overInferenceRisk: false,
      identityQuery: fallbackIdentityQuery,
      deckIntent: fallbackDeckIntent,
      freshnessSensitive: fallbackFreshnessSensitive,
      confidence: 0.51,
      source: "fallback_regex",
      reason: fallbackIdentityQuery ? "identity_recall_fast_path" : "intent_inference_disabled",
      fallbackReason: "AGENT_INTENT_INFERENCE=0",
    };
  }

  const jr = await completeChatJson(client, {
    model: getFastModelSlug(model),
    messages: [
      {
        role: "system",
        content:
          "Classify the user message for harness policy. " +
          "Return JSON only: {intent:'introspection|knowledge|coding|execution',stancePrompt:boolean,overInferenceRisk:boolean," +
          "identityQuery:boolean,deckIntent:boolean,freshnessSensitive:boolean,confidence:number,reason:string}. " +
          "identityQuery=true when user asks about their name, what to call them, who they are, or whether you know/remember their name. " +
          "deckIntent=true when user wants a presentation, slides, deck, slide show, or similar visual document. " +
          "freshnessSensitive=true when user needs current, live, recent, or up-to-date information. " +
          "overInferenceRisk=true when the request invites speculative user-belief attribution.",
      },
      { role: "user", content: userMessage.slice(0, 2000) },
    ],
    maxTokens: 260,
    temperature: 0,
  });
  if (!jr.ok || typeof jr.parsed !== "object" || jr.parsed == null) {
    return {
      intent: fallbackIdentityQuery ? "knowledge" : fallbackIntent,
      stancePrompt: fallbackIdentityQuery ? false : fallbackStance,
      overInferenceRisk: false,
      identityQuery: fallbackIdentityQuery,
      deckIntent: fallbackDeckIntent,
      freshnessSensitive: fallbackFreshnessSensitive,
      confidence: 0.5,
      source: "fallback_regex",
      reason: fallbackIdentityQuery ? "identity_recall_fast_path" : "llm_inference_failed",
      fallbackReason: jr.ok ? "invalid_json_shape" : jr.error,
    };
  }

  const parsed = jr.parsed as Record<string, unknown>;
  const intent = parseIntent(parsed["intent"]) ?? fallbackIntent;
  const confidenceRaw = Number(parsed["confidence"] ?? 0.5);
  const confidence = Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(1, confidenceRaw)) : 0.5;
  const threshold = resolveIntentConfidenceThreshold();

  // LLM-derived semantic flags — OR with regex fallback so neither path loses signal
  const identityQuery = Boolean(parsed["identityQuery"]) || fallbackIdentityQuery;
  const deckIntent = Boolean(parsed["deckIntent"]) || fallbackDeckIntent;
  const freshnessSensitive = Boolean(parsed["freshnessSensitive"]) || fallbackFreshnessSensitive;

  if (confidence < threshold) {
    return {
      intent: identityQuery ? "knowledge" : fallbackIntent,
      stancePrompt: identityQuery ? false : fallbackStance,
      overInferenceRisk: false,
      identityQuery,
      deckIntent,
      freshnessSensitive,
      confidence,
      source: "fallback_regex",
      reason: identityQuery ? "identity_recall_fast_path" : "llm_confidence_below_threshold",
      fallbackReason: `confidence=${confidence.toFixed(2)} < threshold=${threshold.toFixed(2)}`,
    };
  }

  return {
    intent: identityQuery ? "knowledge" : intent,
    stancePrompt: identityQuery ? false : Boolean(parsed["stancePrompt"]),
    overInferenceRisk: identityQuery ? false : Boolean(parsed["overInferenceRisk"]),
    identityQuery,
    deckIntent,
    freshnessSensitive,
    confidence,
    source: "llm",
    reason: typeof parsed["reason"] === "string" ? parsed["reason"].slice(0, 200) : "classified_by_llm",
  };
}

export function resolveMemoryPolicy(
  intent: TurnIntentClass,
  opts?: { userMessage?: string }
): MemoryPolicy {
  if (opts?.userMessage && isIdentityRecallPrompt(opts.userMessage)) {
    return {
      allowAutoRecall: true,
      scope: "both",
      maxAgeDays: 3650,
      minConfidence: 0.1,
      minQueryOverlap: 0.02,
    };
  }
  const debiasOn = process.env["AGENT_MEMORY_DEBIAS"] !== "0";
  if (!debiasOn) {
    return { allowAutoRecall: true, scope: "both" };
  }
  const maxAgeDefault = Math.max(
    7,
    Math.min(3650, parseInt(process.env["AGENT_MEMORY_MAX_AGE_DAYS_DEFAULT"] ?? "540", 10) || 540)
  );
  const minConfDefault = Math.max(
    0,
    Math.min(1, Number(process.env["AGENT_MEMORY_MIN_CONFIDENCE_DEFAULT"] ?? "0.35") || 0.35)
  );
  // Default is memory-first for introspection too; opt into stricter filtering explicitly.
  const strictIntro = process.env["AGENT_MEMORY_INTROSPECTION_STRICT"] === "1";
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
  return process.env["AGENT_OVERINFERENCE_LLM_CHECK"] !== "0";
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

