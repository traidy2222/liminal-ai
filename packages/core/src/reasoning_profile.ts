/**
 * Adaptive reasoning budget: maps intent-inference fields to OpenRouter reasoning
 * params and harness injection text (high effort default for coding/work).
 */
import { effectiveHarnessEnvRaw } from "./harness_effective_env.js";
import type { ReasoningSurface } from "./reasoning_surface.js";

/** Mirrors {@link TurnIntentClass} — kept local to avoid core import cycles. */
export type ReasoningIntentClass =
  | "introspection"
  | "knowledge"
  | "research"
  | "coding"
  | "execution"
  | "conversational"
  | "creative";

/** Orthogonal axis predicted alongside intent. Drives fast-model routing regardless of intent. */
export type TurnComplexity = "trivial" | "normal" | "complex";

/** Budget fields carried on {@link TurnInferenceResult}. */
export interface ReasoningBudgetInferenceSlice {
  intent: ReasoningIntentClass;
  exploratoryCreative?: boolean;
  reasoningEffort?: ReasoningEffort;
  thinkDepth?: ThinkDepth;
  toolFirstBias?: boolean;
  reasoningWordBudget?: number;
  essayRisk?: boolean;
  reasoningBudgetSource?: "llm" | "fallback";
}

export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh";
export type ThinkDepth = "skip" | "brief" | "standard" | "deep";

export interface ReasoningBudget {
  reasoningEffort: ReasoningEffort;
  thinkDepth: ThinkDepth;
  toolFirstBias: boolean;
  reasoningWordBudget: number;
  essayRisk: boolean;
  /** "llm" when classifier fields used; "fallback" when table/default applied. */
  source: "llm" | "fallback";
}

const EFFORT_SET = new Set<ReasoningEffort>(["none", "low", "medium", "high", "xhigh"]);
const DEPTH_SET = new Set<ThinkDepth>(["skip", "brief", "standard", "deep"]);

export function parseReasoningEffort(value: unknown): ReasoningEffort | null {
  if (typeof value === "string" && EFFORT_SET.has(value as ReasoningEffort)) {
    return value as ReasoningEffort;
  }
  return null;
}

export function parseThinkDepth(value: unknown): ThinkDepth | null {
  if (typeof value === "string" && DEPTH_SET.has(value as ThinkDepth)) {
    return value as ThinkDepth;
  }
  return null;
}

export function parseReasoningWordBudget(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(40, Math.min(2000, Math.round(n)));
}

export function isReasoningBudgetClassifierEnabled(): boolean {
  return effectiveHarnessEnvRaw("AGENT_REASONING_BUDGET") !== "0";
}

function resolveDefaultEffort(): ReasoningEffort {
  const raw = effectiveHarnessEnvRaw("AGENT_REASONING_DEFAULT_EFFORT")?.trim().toLowerCase();
  if (raw && EFFORT_SET.has(raw as ReasoningEffort)) return raw as ReasoningEffort;
  return "high";
}

/** Intent-based fallback when classifier off, low confidence, or missing fields. */
export function fallbackReasoningBudget(
  intent: ReasoningIntentClass,
  exploratoryCreative: boolean
): ReasoningBudget {
  const defaultEffort = resolveDefaultEffort();
  if (exploratoryCreative) {
    return {
      reasoningEffort: defaultEffort,
      thinkDepth: "deep",
      toolFirstBias: false,
      reasoningWordBudget: 500,
      essayRisk: false,
      source: "fallback",
    };
  }
  switch (intent) {
    case "coding":
    case "execution":
      return {
        reasoningEffort: defaultEffort,
        thinkDepth: "brief",
        toolFirstBias: true,
        reasoningWordBudget: 150,
        essayRisk: true,
        source: "fallback",
      };
    case "knowledge":
      return {
        reasoningEffort: defaultEffort,
        thinkDepth: "standard",
        toolFirstBias: false,
        reasoningWordBudget: 350,
        essayRisk: false,
        source: "fallback",
      };
    case "research":
      return {
        reasoningEffort: defaultEffort,
        thinkDepth: "brief",
        toolFirstBias: true,
        reasoningWordBudget: 140,
        essayRisk: false,
        source: "fallback",
      };
    case "introspection":
      return {
        reasoningEffort: "medium",
        thinkDepth: "brief",
        toolFirstBias: false,
        reasoningWordBudget: 120,
        essayRisk: false,
        source: "fallback",
      };
    case "conversational":
      // chitchat / persona / continuation — almost no reasoning, no tools, fast turnaround
      return {
        reasoningEffort: "low",
        thinkDepth: "skip",
        toolFirstBias: false,
        reasoningWordBudget: 60,
        essayRisk: true,
        source: "fallback",
      };
    case "creative":
      // generative writing / ideation — deep think, no tool-first bias, large word budget
      return {
        reasoningEffort: defaultEffort,
        thinkDepth: "deep",
        toolFirstBias: false,
        reasoningWordBudget: 500,
        essayRisk: false,
        source: "fallback",
      };
    default:
      return {
        reasoningEffort: defaultEffort,
        thinkDepth: "standard",
        toolFirstBias: false,
        reasoningWordBudget: 300,
        essayRisk: false,
        source: "fallback",
      };
  }
}

/**
 * Merge parsed LLM budget fields with fallback when classifier disabled or fields missing.
 *
 * `learnedEffort` (from outcome_scorer.getBestEffortForIntent) is applied only on the
 * fallback path — when no trusted LLM classification exists, the statistically-best
 * effort recorded for this intent class is a better prior than the static default.
 */
export function resolveReasoningBudget(
  inference: ReasoningBudgetInferenceSlice | null,
  learnedEffort?: ReasoningEffort | null
): ReasoningBudget {
  const intent = inference?.intent ?? "knowledge";
  const exploratory = inference?.exploratoryCreative === true;
  const fb = fallbackReasoningBudget(intent, exploratory);

  let budget: ReasoningBudget;
  if (!inference || !isReasoningBudgetClassifierEnabled()) {
    budget = fb;
  } else {
    const useLlmBudget =
      inference.reasoningBudgetSource === "llm" &&
      inference.reasoningEffort != null &&
      inference.thinkDepth != null;

    if (!useLlmBudget) {
      budget = fb;
    } else {
      budget = {
        reasoningEffort: inference.reasoningEffort ?? fb.reasoningEffort,
        thinkDepth: inference.thinkDepth ?? fb.thinkDepth,
        toolFirstBias: inference.toolFirstBias ?? fb.toolFirstBias,
        reasoningWordBudget: inference.reasoningWordBudget ?? fb.reasoningWordBudget,
        essayRisk: inference.essayRisk ?? fb.essayRisk,
        source: "llm",
      };
    }
  }

  // Learned-effort prior: only when the budget came from fallback (no trusted
  // LLM classification). A confident classifier decision is never overridden.
  if (learnedEffort && budget.source === "fallback") {
    budget = { ...budget, reasoningEffort: learnedEffort };
  }

  return budget;
}

/**
 * Tighten the reasoning budget for implement/research/essay-trap prompts.
 *
 * When `llmSignals` is provided (the typed booleans the fast-model classifier
 * already returns), trust those — they handle paraphrases the regex can't (e.g.
 * "spin up a Tetris clone", "what's the latest on the OpenAI breakup", "shock
 * me with a novel scheduler"). When the classifier was off / failed / low
 * confidence, fall back to the keyword regex so the harness still degrades
 * gracefully without an LLM round-trip available.
 *
 * Kept as a separate signal-consumer (not folded into applyTurnInferenceHeuristics)
 * because this runs at a different layer — after the reasoning budget has been
 * assembled — and protects the budget specifically, while the heuristic protects
 * the intent class.
 */
export function tightenReasoningBudgetForUserMessage(
  budget: ReasoningBudget,
  userMessage: string,
  llmSignals?: LlmTurnSignals
): ReasoningBudget {
  let wantsShip: boolean;
  let wantsBuild: boolean;
  let wantsResearch: boolean;
  let essayTrap: boolean;

  if (llmSignals) {
    wantsShip = llmSignals.implementShip;
    wantsBuild = llmSignals.buildDeliverable;
    wantsResearch = llmSignals.freshnessSensitive;
    // The classifier's `essayRisk` is the holistic "model will ramble before
    // tools" signal — covers the old algorithm/TSP/zero-shot regex trap plus
    // any analogous case the keyword list missed.
    essayTrap = llmSignals.essayRisk && wantsShip;
  } else {
    const t = userMessage.toLowerCase();
    wantsShip =
      /\b(implement|write\b.*\b(python|code)|runnable|run it|test it|zero-?shot|from scratch|make it runnable|show the results)\b/.test(
        t
      );
    wantsResearch =
      /\b(what'?s going on|update (me )?on|latest|current(ly)?|up[- ]?to[- ]?date|breaking|headlines?|situation|developments?)\b/.test(
        t
      ) || /\b(iran|ukraine|israel|gaza|middle east|ceasefire)\b/.test(t);
    wantsBuild =
      /\b(build|create|make|implement|write|code|ship)\b/.test(t) &&
      /\b(for yourself|for me|something|a file|an? (html|app|page|tool|script)|now)\b/.test(t);
    essayTrap =
      /\b(algorithm|solve|design|traveling salesman|tsp|np-?hard|zero-?shot)\b/.test(t) && wantsShip;
  }

  if (!wantsShip && !essayTrap && !wantsResearch && !wantsBuild) return budget;

  const wordCap = essayTrap ? 90 : wantsResearch ? 140 : wantsBuild ? 130 : 120;
  const effort: ReasoningEffort =
    essayTrap && budget.reasoningEffort === "xhigh"
      ? "high"
      : essayTrap && (budget.reasoningEffort === "high" || budget.reasoningEffort === "xhigh")
        ? "medium"
        : budget.reasoningEffort;

  return {
    ...budget,
    reasoningEffort: effort,
    thinkDepth: "brief",
    toolFirstBias: true,
    reasoningWordBudget: Math.min(budget.reasoningWordBudget, wordCap),
    essayRisk: budget.essayRisk || essayTrap || wantsShip,
    source: budget.source,
  };
}

/**
 * Subset of TurnInferenceResult signals used by the budget tightener. Passed
 * structurally (not by importing the full TurnInferenceResult type) so this
 * module stays free of a circular import with intent_inference.ts.
 */
export interface LlmTurnSignals {
  implementShip: boolean;
  buildDeliverable: boolean;
  freshnessSensitive: boolean;
  essayRisk: boolean;
}

export function buildOpenRouterReasoningParam(
  budget: ReasoningBudget,
  surface: ReasoningSurface = "native"
): { reasoning: { effort: ReasoningEffort; max_tokens?: number } } | Record<string, never> {
  if (surface === "external") {
    return {};
  }
  if (budget.reasoningEffort === "none") {
    return { reasoning: { effort: "none" } };
  }
  const reasoning: { effort: ReasoningEffort; max_tokens?: number } = {
    effort: budget.reasoningEffort,
  };
  if (budget.toolFirstBias || budget.essayRisk) {
    reasoning.max_tokens = Math.max(
      192,
      Math.min(1536, Math.round(budget.reasoningWordBudget * 10))
    );
  }
  return { reasoning };
}

export function buildReasoningBudgetInjection(
  budget: ReasoningBudget,
  surface: ReasoningSurface = "native"
): string {
  const thinkNote =
    surface === "native"
      ? budget.thinkDepth === "skip"
        ? "skip think() unless scope/families are unclear."
        : "On native models: think() structured only (tool_families, scope, ≤3 bullets) — no reasoning essay."
      : budget.thinkDepth === "skip"
        ? "skip think() and reason() unless scope/families are unclear."
        : budget.thinkDepth === "brief"
          ? "think() brief: scope, tool_families, ≤3 bullets — no pseudocode. reason() for quick between-step inference."
          : budget.thinkDepth === "deep"
            ? "think() may go deeper for synthesis. reason() between steps to interpret results — still no full code in either."
            : "think() standard depth when scope needs clarification. reason() to interpret tool results and derive next steps.";

  const toolNote = budget.toolFirstBias
    ? "Tool-first HARD LIMIT: ≤" +
      String(budget.reasoningWordBudget) +
      " words total in think()+reason() combined, then you MUST call tools (web_search/web_fetch for research; write_file/run_shell for builds). " +
      "Do not narrate planned tool calls in think/reason — execute them. One feasibility sentence max, then tools."
    : "Use tools for implementation; do not substitute think()/reason() for execution.";

  const essayNote = budget.essayRisk
    ? "Essay-trap turn: no multi-phase algorithm writeups, no pseudocode blocks in think() or reason()."
    : "";

  return (
    "[REASONING BUDGET] Obey this turn's budget (classifier-set). " +
    `effort=${budget.reasoningEffort}; think=${budget.thinkDepth}; soft_word_budget≈${budget.reasoningWordBudget}; ` +
    `toolFirst=${budget.toolFirstBias ? "yes" : "no"}; essayRisk=${budget.essayRisk ? "yes" : "no"}. ` +
    `${thinkNote} ${toolNote} ${essayNote} ` +
    "think() is for planning and orientation; reason() is for inter-step inference — neither replaces tool execution. " +
    "If constraints are impossible, one sentence of honesty then best-effort via tools."
  );
}

export function resolveReasoningStallNudgeThresholdChars(budget: ReasoningBudget): number {
  const floorRaw = effectiveHarnessEnvRaw("AGENT_REASONING_NUDGE_CHARS")?.trim();
  const floor = floorRaw ? Number(floorRaw) : 2500;
  const floorN = Number.isFinite(floor) ? Math.max(400, Math.min(12000, Math.round(floor))) : 2500;
  const fromBudget = budget.reasoningWordBudget * 5;
  if (budget.toolFirstBias || budget.essayRisk) {
    return Math.max(450, Math.min(fromBudget, floorN));
  }
  return Math.max(floorN, fromBudget);
}

export function formatReasoningBudgetTraceLine(
  budget: ReasoningBudget,
  surface?: ReasoningSurface
): string {
  const surfacePart = surface ? ` surface=${surface}` : "";
  return (
    `[reasoning:${surfacePart} effort=${budget.reasoningEffort} think=${budget.thinkDepth} ` +
    `toolFirst=${budget.toolFirstBias ? "yes" : "no"} budget=${budget.reasoningWordBudget} ` +
    `src=${budget.source}]\n`
  );
}

/** Brief think() args threshold after native reasoning already used. */
export const NATIVE_DUPLICATE_THINK_CHARS = 400;

export function shouldAbortForDuplicateThinkAfterNative(
  surface: ReasoningSurface,
  reasoningChars: number,
  thinkArgsChars: number
): boolean {
  return (
    surface === "native" &&
    reasoningChars > 300 &&
    thinkArgsChars >= NATIVE_DUPLICATE_THINK_CHARS
  );
}

/** Parse budget fields from intent LLM JSON into partial TurnInferenceResult slices. */
export function parseReasoningBudgetFromParsed(parsed: Record<string, unknown>): {
  reasoningEffort?: ReasoningEffort;
  thinkDepth?: ThinkDepth;
  toolFirstBias?: boolean;
  reasoningWordBudget?: number;
  essayRisk?: boolean;
  reasoningBudgetSource?: "llm";
} {
  const reasoningEffort = parseReasoningEffort(parsed["reasoningEffort"]);
  const thinkDepth = parseThinkDepth(parsed["thinkDepth"]);
  const toolFirstBias =
    parsed["toolFirstBias"] === true || parsed["toolFirstBias"] === false
      ? Boolean(parsed["toolFirstBias"])
      : undefined;
  const reasoningWordBudget = parseReasoningWordBudget(parsed["reasoningWordBudget"]);
  const essayRisk =
    parsed["essayRisk"] === true || parsed["essayRisk"] === false
      ? Boolean(parsed["essayRisk"])
      : undefined;

  const hasAny =
    reasoningEffort != null ||
    thinkDepth != null ||
    toolFirstBias !== undefined ||
    reasoningWordBudget != null ||
    essayRisk !== undefined;

  if (!hasAny) return {};

  return {
    ...(reasoningEffort != null ? { reasoningEffort } : {}),
    ...(thinkDepth != null ? { thinkDepth } : {}),
    ...(toolFirstBias !== undefined ? { toolFirstBias } : {}),
    ...(reasoningWordBudget != null ? { reasoningWordBudget } : {}),
    ...(essayRisk !== undefined ? { essayRisk } : {}),
    reasoningBudgetSource: "llm",
  };
}

/** Apply fallback budget fields onto inference when LLM budget should not be trusted. */
export function applyFallbackReasoningFields<T extends ReasoningBudgetInferenceSlice>(
  inference: T,
  useLlmBudget: boolean
): T {
  if (useLlmBudget && isReasoningBudgetClassifierEnabled()) {
    return inference;
  }
  const fb = fallbackReasoningBudget(inference.intent, inference.exploratoryCreative === true);
  return {
    ...inference,
    reasoningEffort: fb.reasoningEffort,
    thinkDepth: fb.thinkDepth,
    toolFirstBias: fb.toolFirstBias,
    reasoningWordBudget: fb.reasoningWordBudget,
    essayRisk: fb.essayRisk,
    reasoningBudgetSource: "fallback",
  };
}
