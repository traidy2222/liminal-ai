/**
 * Fast-model judge for research-task finalize completeness.
 *
 * Replaces a stack of brittle regexes that classified an assistant draft by
 * looking for keywords like "timeline", "uncertain", "open question", and a
 * curated outlet list ("reuters|bbc|ap|al jazeera|wikipedia|france24|guardian|
 * nyt"). The regex missed valid drafts that paraphrased these properties or
 * cited outlets outside the curated list (Bloomberg, FT, Politico, etc).
 *
 * The judge runs a single tight `completeChatJson` call on the fast model with
 * a small token budget (~200) and short timeout (~6s). On any failure (LLM
 * timeout, JSON parse error, etc.) the caller falls back to the regex.
 */
import type { OpenAI } from "openai";
import { completeChatJson, getFastModelSlug } from "./router.js";
import { effectiveHarnessEnvRaw } from "./harness_effective_env.js";

export interface ResearchFinalizeVerdict {
  /** Draft contains a sequence/timeline of events (paraphrase-tolerant). */
  hasTimeline: boolean;
  /** Approximate count of distinct sources named in the draft (0–N). */
  sourcesNamed: number;
  /** Draft acknowledges uncertainty / fragility / things that might change. */
  hasUncertainty: boolean;
  /** Draft surfaces unresolved questions / open items / things to confirm. */
  hasOpenItems: boolean;
  /** All four checks pass — draft is ready to ship as-is. */
  ready: boolean;
  /** Short rationale (≤120 chars) for telemetry/debugging. */
  reason: string;
  /** "llm" when judge ran successfully; "fallback" when regex was used. */
  source: "llm" | "fallback";
}

function judgeTimeoutMs(): number {
  const raw = effectiveHarnessEnvRaw("AGENT_FINALIZE_JUDGE_TIMEOUT_MS");
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.min(30_000, n) : 6_000;
}

function isJudgeEnabled(): boolean {
  return effectiveHarnessEnvRaw("AGENT_FINALIZE_JUDGE") !== "0";
}

const JUDGE_SYSTEM_PROMPT =
  "You are evaluating a research draft for completeness. Return JSON only with exactly these keys: " +
  "{hasTimeline:boolean,sourcesNamed:number,hasUncertainty:boolean,hasOpenItems:boolean,ready:boolean,reason:string}. " +
  "hasTimeline=true when the draft presents a sequence of events with relative or absolute time markers — paraphrases count " +
  "('the day after', 'in the following weeks', 'by Tuesday', explicit dates, 'first…then…finally'). " +
  "sourcesNamed=integer count of distinct sources/outlets/publications/authors/URLs cited in the draft. " +
  "Count Bloomberg, FT, Politico, Bellingcat, ISW, Substack handles, academic citations, named experts, etc. — NOT just a curated outlet list. " +
  "Count each distinct source once, even if cited multiple times. " +
  "hasUncertainty=true when the draft explicitly acknowledges something is uncertain, unverified, fragile, contested, or may change. " +
  "Paraphrases count ('it's not yet clear', 'reports conflict', 'this could shift', 'with low confidence'). " +
  "hasOpenItems=true when the draft surfaces unresolved questions, things to confirm, or items the analyst should follow up on. " +
  "Paraphrases count ('worth watching', 'TBD', 'pending confirmation', 'still being investigated', 'we don't yet know'). " +
  "ready=true ONLY when hasTimeline && sourcesNamed>=2 && hasUncertainty && hasOpenItems. " +
  "reason: ≤120 chars explaining which checks passed/failed and why.";

/**
 * Run the fast-model judge. Throws on transport/parse failure so the caller can
 * fall back to the regex.
 */
export async function judgeResearchFinalize(
  client: OpenAI,
  mainModel: string,
  assistantDraft: string
): Promise<ResearchFinalizeVerdict> {
  if (!isJudgeEnabled()) {
    throw new Error("AGENT_FINALIZE_JUDGE=0");
  }

  const trimmed = assistantDraft.trim();
  if (trimmed.length < 200) {
    // Too short to be a research draft worth judging; declare not-ready
    // deterministically without spending an LLM call.
    return {
      hasTimeline: false,
      sourcesNamed: 0,
      hasUncertainty: false,
      hasOpenItems: false,
      ready: false,
      reason: "draft_too_short",
      source: "llm",
    };
  }

  // Bound payload size — research drafts can be huge; the judge only needs
  // structural signal, not the full prose.
  const sampled =
    trimmed.length <= 6000
      ? trimmed
      : `${trimmed.slice(0, 4500)}\n\n[...draft truncated for judge — original length=${trimmed.length}...]\n\n${trimmed.slice(-1200)}`;

  const jr = await completeChatJson(client, {
    model: getFastModelSlug(mainModel),
    messages: [
      { role: "system", content: JUDGE_SYSTEM_PROMPT },
      { role: "user", content: `RESEARCH_DRAFT:\n${sampled}` },
    ],
    maxTokens: 240,
    temperature: 0,
    signal: AbortSignal.timeout(judgeTimeoutMs()),
  });

  if (!jr.ok || typeof jr.parsed !== "object" || jr.parsed == null) {
    throw new Error(jr.ok ? "invalid_json_shape" : jr.error);
  }

  const p = jr.parsed as Record<string, unknown>;
  const hasTimeline = Boolean(p["hasTimeline"]);
  const sourcesNamedRaw = Number(p["sourcesNamed"] ?? 0);
  const sourcesNamed = Number.isFinite(sourcesNamedRaw) ? Math.max(0, Math.min(20, Math.floor(sourcesNamedRaw))) : 0;
  const hasUncertainty = Boolean(p["hasUncertainty"]);
  const hasOpenItems = Boolean(p["hasOpenItems"]);
  // Re-derive `ready` server-side so we don't trust the model's own gate.
  const ready = hasTimeline && sourcesNamed >= 2 && hasUncertainty && hasOpenItems;
  const reason = typeof p["reason"] === "string" ? p["reason"].slice(0, 200) : "judged_by_llm";

  return {
    hasTimeline,
    sourcesNamed,
    hasUncertainty,
    hasOpenItems,
    ready,
    reason,
    source: "llm",
  };
}

/**
 * Regex fallback used when the judge errors, times out, or is disabled. Same
 * keyword sets as the historical inline checks in agent.ts (preserved verbatim
 * so behavior is identical when the LLM judge is unavailable).
 */
export function judgeResearchFinalizeWithRegex(assistantDraft: string): ResearchFinalizeVerdict {
  const hasTimeline = /\b(chronology|timeline|sequence|on\s+\w+\s+\d{1,2}|recently|earlier)\b/i.test(assistantDraft);
  const sourcesNamed = (assistantDraft.match(/https?:\/\/|reuters|bbc|ap|al jazeera|wikipedia|france24|guardian|nyt/gi) ?? []).length;
  const hasUncertainty = /\b(uncertain|unverified|fragile|confidence|may change|developing)\b/i.test(assistantDraft);
  const hasOpenItems = /\b(open question|unknown|unresolved|to confirm|not yet clear)\b/i.test(assistantDraft);
  const ready = hasTimeline && sourcesNamed >= 2 && hasUncertainty && hasOpenItems;
  return {
    hasTimeline,
    sourcesNamed,
    hasUncertainty,
    hasOpenItems,
    ready,
    reason: `regex_fallback (timeline=${hasTimeline} sources=${sourcesNamed} unc=${hasUncertainty} open=${hasOpenItems})`,
    source: "fallback",
  };
}
