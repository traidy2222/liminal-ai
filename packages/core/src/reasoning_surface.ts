/**
 * Model-aware reasoning surface: native (OpenRouter reasoning stream) vs external (think tool).
 */
import { effectiveHarnessEnvRaw } from "./harness_effective_env.js";
import type { ReasoningBudget, ThinkDepth } from "./reasoning_profile.js";

export type ReasoningSurface = "native" | "external";

export type ReasoningSurfaceSource = "env" | "slug_list" | "slug_heuristic" | "default";

export interface ReasoningSurfaceResolution {
  surface: ReasoningSurface;
  source: ReasoningSurfaceSource;
}

const DEFAULT_NATIVE_SLUGS = "";

function slugMatchesList(slug: string, csv: string | undefined): boolean {
  if (!csv?.trim()) return false;
  const lower = slug.toLowerCase();
  for (const part of csv.split(",")) {
    const p = part.trim().toLowerCase();
    if (p && lower.includes(p)) return true;
  }
  return false;
}

function slugMatchesNativeHeuristic(slug: string): boolean {
  const s = slug.toLowerCase();
  if (s.startsWith("openai/o1") || s.startsWith("openai/o3")) return true;
  if (s.startsWith("openai/gpt-5")) return true;
  if (/-r1\b/i.test(s) && !/vision/i.test(s)) return true;
  return false;
}

export function resolveReasoningSurface(modelSlug: string): ReasoningSurfaceResolution {
  const mode = effectiveHarnessEnvRaw("AGENT_REASONING_SURFACE")?.trim().toLowerCase() ?? "auto";
  if (mode === "native") return { surface: "native", source: "env" };
  if (mode === "external") return { surface: "external", source: "env" };

  const externalCsv = effectiveHarnessEnvRaw("AGENT_REASONING_EXTERNAL_SLUGS");
  if (slugMatchesList(modelSlug, externalCsv)) {
    return { surface: "external", source: "slug_list" };
  }

  const nativeCsv =
    effectiveHarnessEnvRaw("AGENT_REASONING_NATIVE_SLUGS")?.trim() || DEFAULT_NATIVE_SLUGS;
  if (slugMatchesList(modelSlug, nativeCsv) || slugMatchesNativeHeuristic(modelSlug)) {
    return { surface: "native", source: slugMatchesList(modelSlug, nativeCsv) ? "slug_list" : "slug_heuristic" };
  }

  return { surface: "external", source: "default" };
}

export function shouldSendOpenRouterReasoningParam(surface: ReasoningSurface): boolean {
  return surface === "native";
}

export function effectiveThinkDepthForSurface(
  surface: ReasoningSurface,
  thinkDepth: ThinkDepth,
  toolFirstBias: boolean
): ThinkDepth {
  if (surface !== "native") return thinkDepth;
  if (thinkDepth === "skip") return "skip";
  if (toolFirstBias && (thinkDepth === "deep" || thinkDepth === "standard")) {
    return "brief";
  }
  return thinkDepth;
}

export function applySurfaceToBudget(
  budget: ReasoningBudget,
  surface: ReasoningSurface
): ReasoningBudget {
  const thinkDepth = effectiveThinkDepthForSurface(
    surface,
    budget.thinkDepth,
    budget.toolFirstBias
  );
  return { ...budget, thinkDepth };
}

export function buildReasoningSurfaceInjection(
  resolution: ReasoningSurfaceResolution,
  modelSlug: string
): string {
  if (resolution.surface === "native") {
    return (
      `[REASONING SURFACE] native (model=${modelSlug}; via=${resolution.source}). ` +
      "This model streams native reasoning (MODEL REASONING panel). Use that channel for scoping and feasibility. " +
      "Do not repeat the same analysis in think(). think() only for tool_families[], scope, ≤3 bullets, or clarification_needed."
    );
  }
  return (
    `[REASONING SURFACE] external (model=${modelSlug}; via=${resolution.source}). ` +
    "No native reasoning stream. Two explicit reasoning tools are available: " +
    "think() for planning, orientation, and scope declaration (before major actions or after unexpected results); " +
    "reason() for lightweight inter-step inference (interpreting a tool result, connecting A→B, deciding next action). " +
    "Use think() when the task needs orienting; use reason() when you just got a result and need to derive the next step. " +
    "Follow thinkDepth from [REASONING BUDGET] for how deep think() should go."
  );
}

/** User message matches implement-and-ship pattern (TSP trap, zero-shot code). */
export function isImplementShipUserMessage(userMessage: string): boolean {
  const t = userMessage.toLowerCase();
  return /\b(implement|write\b.*\b(python|code)|runnable|run it|test it|zero-?shot|from scratch|make it runnable|show the results)\b/.test(
    t
  );
}

/** User needs live/current news or situational updates (web_search/web_fetch). */
export function isResearchFreshnessUserMessage(userMessage: string): boolean {
  const t = userMessage.toLowerCase();
  if (/\b(explain|what is|how does|history of|in general)\b/.test(t) && !/\b(latest|current|today|now|going on)\b/.test(t)) {
    return false;
  }
  return (
    /\b(what'?s going on|update (me )?on|catch me up|bring me up to speed|latest|current(ly)?|up[- ]?to[- ]?date|recent|right now|today|this week|breaking|headlines?|situation|developments?|what happened)\b/.test(
      t
    ) ||
    /\b(iran|ukraine|israel|gaza|taiwan|middle east|ceasefire|war with|conflict in)\b/.test(t)
  );
}

/** User wants a concrete artifact built (file/app/page), not open-ended ideation. */
export function isBuildDeliverableUserMessage(userMessage: string): boolean {
  const t = userMessage.toLowerCase();
  if (/\b(explain|describe|what would|imagine|hypothetical|if you could|thought experiment)\b/.test(t)) {
    return false;
  }
  return (
    /\b(build|create|make|implement|write|code|ship)\b/.test(t) &&
    /\b(for yourself|for me|something|a file|an? (html|app|page|tool|script|site)|now|from scratch)\b/.test(t)
  );
}
