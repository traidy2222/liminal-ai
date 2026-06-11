/**
 * Turn outcome scorer + adaptive reasoning effort learning.
 *
 * Heuristically scores each send() outcome (0–1) from process signals (tool
 * success, rounds, termination). When AGENT_OUTCOME_IMPLICIT_FEEDBACK=1 (default),
 * learning loops defer until the user's next message: corrections/retries pull the
 * score down; thanks/topic changes pull it up. Optional fast-model judge (~10% sample)
 * and eval-suite golden outcomes ground the same stats file.
 *
 * Gate: AGENT_EFFORT_LEARN=1 for persistence.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type OpenAI from "openai";
import { effectiveHarnessEnvRaw } from "./harness_effective_env.js";
import { classifyImplicitFollowUpFeedback } from "./input_semantics.js";
import type { ImplicitFollowUpKind } from "./input_semantics.js";
import { completeChatJson, getFastModelSlug } from "./router.js";
import type { ProviderRouteState } from "./provider_route_state.js";
import type { ReasoningEffort, ReasoningIntentClass } from "./reasoning_profile.js";
import { recordRuleOutcomes } from "./rule_stats.js";
import { recordRecipe, recordRecipePrimeOutcome } from "./recipe_library.js";

// ─── Outcome score ────────────────────────────────────────────────────────────

export interface TurnOutcomeInput {
  toolsUsed: Array<{ name: string; ok: boolean }>;
  roundCount: number;
  criticPassed: boolean | null;
  contradictionCount: number;
  terminationReason: "ok" | "round_cap" | "timeout" | "error";
}

/**
 * Produce a normalized outcome score [0, 1] for a completed send.
 * 1.0 = perfect; 0.0 = total failure. Measures *process*, not answer correctness.
 */
export function scoreTurnOutcome(input: TurnOutcomeInput): number {
  let score = 0.5; // neutral baseline

  const total = input.toolsUsed.length;
  if (total > 0) {
    const successRate = input.toolsUsed.filter((t) => t.ok).length / total;
    score += (successRate - 0.5) * 0.35; // ±0.175
  }

  if (input.terminationReason === "round_cap") score -= 0.15;
  if (input.terminationReason === "timeout") score -= 0.2;
  if (input.terminationReason === "error") score -= 0.25;

  if (total > 0 && input.roundCount > 0) {
    const efficiency = Math.min(1, total / Math.max(input.roundCount, 1) / 3);
    score += efficiency * 0.1;
  }

  if (input.criticPassed === true) score += 0.1;
  if (input.criticPassed === false) score -= 0.12;

  const contraPenalty = Math.min(0.15, input.contradictionCount * 0.05);
  score -= contraPenalty;

  return Math.max(0, Math.min(1, score));
}

// ─── Refined outcome (implicit feedback + judge) ─────────────────────────────

export function isDeferredOutcomeLearningEnabled(): boolean {
  return effectiveHarnessEnvRaw("AGENT_OUTCOME_IMPLICIT_FEEDBACK") !== "0";
}

function outcomeJudgeEnabled(): boolean {
  return effectiveHarnessEnvRaw("AGENT_OUTCOME_JUDGE") !== "0";
}

function outcomeJudgeSampleRate(): number {
  const raw = Number(effectiveHarnessEnvRaw("AGENT_OUTCOME_JUDGE_SAMPLE_RATE") ?? "0.1");
  if (!Number.isFinite(raw)) return 0.1;
  return Math.max(0, Math.min(1, raw));
}

export interface RefineTurnOutcomeInput {
  processScore: number;
  implicitKind: ImplicitFollowUpKind;
  implicitScore: number | null;
  judgeScore?: number | null;
}

export interface RefinedTurnOutcome {
  effectiveScore: number;
  processScore: number;
  implicitScore: number | null;
  judgeScore: number | null;
  implicitKind: ImplicitFollowUpKind;
}

/**
 * Blend process heuristic with implicit follow-up and optional judge scores.
 */
export function refineTurnOutcome(input: RefineTurnOutcomeInput): RefinedTurnOutcome {
  const processScore = clamp01(input.processScore);
  const implicitScore =
    input.implicitScore === null || input.implicitScore === undefined
      ? null
      : clamp01(input.implicitScore);
  const judgeScore =
    input.judgeScore === null || input.judgeScore === undefined
      ? null
      : clamp01(input.judgeScore);

  let effectiveScore = processScore;

  if (implicitScore !== null) {
    const negative = input.implicitKind === "correction" || input.implicitKind === "retry";
    const processWeight = negative ? 0.3 : 0.45;
    effectiveScore = processWeight * processScore + (1 - processWeight) * implicitScore;
  }

  if (judgeScore !== null) {
    if (implicitScore !== null) {
      effectiveScore = 0.2 * processScore + 0.45 * implicitScore + 0.35 * judgeScore;
    } else {
      effectiveScore = 0.5 * processScore + 0.5 * judgeScore;
    }
  }

  return {
    effectiveScore: clamp01(effectiveScore),
    processScore,
    implicitScore,
    judgeScore,
    implicitKind: input.implicitKind,
  };
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

// ─── Pending turn learning (deferred until next user message) ─────────────────

export interface PendingTurnLearningRecord {
  processScore: number;
  intentClass: ReasoningIntentClass;
  effort?: ReasoningEffort;
  ruleIds: string[];
  recipeKey?: string;
  userGoal: string;
  assistantPreview: string;
  toolOutcomes: Array<{ name: string; ok: boolean }>;
  toolsUsed: string[];
  recipeEligible: boolean;
  queuedAt: string;
}

export function buildPendingTurnLearning(input: {
  processScore: number;
  intentClass: ReasoningIntentClass;
  effort?: ReasoningEffort;
  ruleIds: string[];
  recipeKey?: string;
  userGoal: string;
  assistantPreview: string;
  toolOutcomes: Array<{ name: string; ok: boolean }>;
  toolsUsed: string[];
  recipeEligible: boolean;
}): PendingTurnLearningRecord {
  return {
    processScore: input.processScore,
    intentClass: input.intentClass,
    effort: input.effort,
    ruleIds: [...input.ruleIds],
    recipeKey: input.recipeKey,
    userGoal: input.userGoal,
    assistantPreview: input.assistantPreview,
    toolOutcomes: input.toolOutcomes.map((t) => ({ ...t })),
    toolsUsed: [...input.toolsUsed],
    recipeEligible: input.recipeEligible,
    queuedAt: new Date().toISOString(),
  };
}

export interface ApplyPendingTurnLearningOpts {
  pending: PendingTurnLearningRecord;
  followUpMessage: string;
  client?: OpenAI;
  routeState?: ProviderRouteState;
  fastModel?: string;
  /** When true, skip implicit classification (session reset flush). */
  processOnly?: boolean;
}

/**
 * Resolve a queued turn with the user's follow-up (or process-only flush) and
 * write effort / rule / recipe learning records.
 */
export async function applyPendingTurnLearning(opts: ApplyPendingTurnLearningOpts): Promise<RefinedTurnOutcome> {
  const feedback = opts.processOnly
    ? { kind: "neutral" as const, confidence: 0, implicitScore: null }
    : classifyImplicitFollowUpFeedback(opts.followUpMessage);

  let judgeScore: number | null = null;
  if (
    !opts.processOnly &&
    outcomeJudgeEnabled() &&
    opts.client &&
    Math.random() < outcomeJudgeSampleRate()
  ) {
    judgeScore = await judgeTurnOutcomeWithFastModel({
      client: opts.client,
      routeState: opts.routeState,
      fastModel: opts.fastModel,
      userGoal: opts.pending.userGoal,
      assistantPreview: opts.pending.assistantPreview,
      toolOutcomes: opts.pending.toolOutcomes,
    });
  }

  const refined = refineTurnOutcome({
    processScore: opts.pending.processScore,
    implicitKind: feedback.kind,
    implicitScore: feedback.implicitScore,
    judgeScore,
  });

  await recordTurnLearningOutcome({
    pending: opts.pending,
    refined,
    judgeSampled: judgeScore !== null,
  });

  return refined;
}

async function judgeTurnOutcomeWithFastModel(input: {
  client: OpenAI;
  routeState?: ProviderRouteState;
  fastModel?: string;
  userGoal: string;
  assistantPreview: string;
  toolOutcomes: Array<{ name: string; ok: boolean }>;
}): Promise<number | null> {
  const toolSummary =
    input.toolOutcomes.length === 0
      ? "(no tools)"
      : input.toolOutcomes
          .slice(0, 12)
          .map((t) => `${t.name}:${t.ok ? "ok" : "fail"}`)
          .join(", ");
  const model = input.fastModel ?? getFastModelSlug("");

  try {
    const jr = await completeChatJson(input.client, {
      model,
      isFastModel: true,
      routeState: input.routeState,
      temperature: 0,
      maxTokens: 80,
      cache: false,
      messages: [
        {
          role: "system",
          content:
            "Score whether the assistant satisfactorily answered the user's request. " +
            'Return JSON only: {"score":0.0-1.0} where 1.0=fully correct/helpful, 0.0=wrong/unhelpful. ' +
            "Judge the answer quality, not tool success alone.",
        },
        {
          role: "user",
          content:
            `User request: ${input.userGoal.slice(0, 600)}\n` +
            `Assistant answer (preview): ${input.assistantPreview.slice(0, 800)}\n` +
            `Tools: ${toolSummary}`,
        },
      ],
    });
    if (!jr.ok || typeof jr.parsed !== "object" || jr.parsed === null) return null;
    const score = (jr.parsed as { score?: unknown }).score;
    const n = typeof score === "number" ? score : Number(score);
    if (!Number.isFinite(n)) return null;
    return clamp01(n);
  } catch {
    return null;
  }
}

// ─── Effort stats persistence ─────────────────────────────────────────────────

interface EffortCell {
  count: number;
  scoreSum: number;
  lastAt: string;
}

interface OutcomeCalibration {
  samples: number;
  processSum: number;
  refinedSum: number;
  judgeSum: number;
  judgeCount: number;
  implicitSignalCount: number;
  evalPass: number;
  evalFail: number;
}

interface EffortStatsFile {
  version: 1;
  cells: Record<string, EffortCell>;
  calibration?: OutcomeCalibration;
  eval_cells?: Record<string, EffortCell>;
}

type StatsFile = {
  entries?: Record<string, unknown>;
  effort_stats?: EffortStatsFile;
  recipes?: Record<string, unknown>;
  [k: string]: unknown;
};

async function loadStatsFile(): Promise<StatsFile> {
  try {
    const { recipeStatsPaths, pickReadPath } = await import("./global_storage.js");
    const p = await pickReadPath(recipeStatsPaths());
    const raw = await readFile(p, "utf8");
    return JSON.parse(raw) as StatsFile;
  } catch {
    return { entries: {} };
  }
}

async function saveStatsFile(data: StatsFile): Promise<void> {
  const { recipeStatsPaths, pickWritePath, ensureGlobalStorageRoot } = await import(
    "./global_storage.js"
  );
  await ensureGlobalStorageRoot();
  const p = await pickWritePath(recipeStatsPaths());
  await mkdir(join(p, ".."), { recursive: true });
  await writeFile(p, JSON.stringify(data, null, 2), "utf8");
}

function isEnabled(): boolean {
  return effectiveHarnessEnvRaw("AGENT_EFFORT_LEARN") === "1";
}

function evalOutcomeLearnEnabled(): boolean {
  return effectiveHarnessEnvRaw("AGENT_EVAL_OUTCOME_LEARN") !== "0";
}

function bumpCalibration(
  cal: OutcomeCalibration,
  patch: Partial<OutcomeCalibration> & {
    processScore: number;
    refinedScore: number;
    judgeScore?: number | null;
    hadImplicit: boolean;
  }
): OutcomeCalibration {
  return {
    samples: cal.samples + 1,
    processSum: cal.processSum + patch.processScore,
    refinedSum: cal.refinedSum + patch.refinedScore,
    judgeSum: cal.judgeSum + (patch.judgeScore ?? 0),
    judgeCount: cal.judgeCount + (patch.judgeScore !== null && patch.judgeScore !== undefined ? 1 : 0),
    implicitSignalCount: cal.implicitSignalCount + (patch.hadImplicit ? 1 : 0),
    evalPass: cal.evalPass + (patch.evalPass ?? 0),
    evalFail: cal.evalFail + (patch.evalFail ?? 0),
  };
}

async function recordTurnLearningOutcome(input: {
  pending: PendingTurnLearningRecord;
  refined: RefinedTurnOutcome;
  judgeSampled: boolean;
  weight?: number;
}): Promise<void> {
  const weight = input.weight ?? 1;
  const outcome = input.refined.effectiveScore;

  if (input.pending.ruleIds.length > 0) {
    void recordRuleOutcomes(input.pending.ruleIds, outcome).catch(() => { /* non-fatal */ });
  }
  if (input.pending.recipeKey) {
    void recordRecipePrimeOutcome(input.pending.recipeKey, outcome).catch(() => { /* non-fatal */ });
  }
  if (input.pending.effort) {
    await recordEffortOutcome(input.pending.intentClass, input.pending.effort, outcome, { weight });
  }
  if (input.pending.recipeEligible) {
    void recordRecipe({
      intentClass: input.pending.intentClass,
      tools: input.pending.toolsUsed,
      goal: input.pending.userGoal,
      outcome,
    }).catch(() => { /* non-fatal */ });
  }

  if (!isEnabled()) return;
  try {
    const data = await loadStatsFile();
    const effortStats: EffortStatsFile = data.effort_stats ?? { version: 1, cells: {} };
    const cal = effortStats.calibration ?? {
      samples: 0,
      processSum: 0,
      refinedSum: 0,
      judgeSum: 0,
      judgeCount: 0,
      implicitSignalCount: 0,
      evalPass: 0,
      evalFail: 0,
    };
    effortStats.calibration = bumpCalibration(cal, {
      processScore: input.refined.processScore,
      refinedScore: input.refined.effectiveScore,
      judgeScore: input.judgeSampled ? input.refined.judgeScore : null,
      hadImplicit: input.refined.implicitScore !== null,
    });
    data.effort_stats = effortStats;
    await saveStatsFile(data);
  } catch {
    /* non-fatal */
  }
}

/**
 * Record an outcome for a (intent_class, effort_level) pair.
 * Silently no-ops if AGENT_EFFORT_LEARN is not "1".
 */
export async function recordEffortOutcome(
  intent: ReasoningIntentClass,
  effort: ReasoningEffort,
  outcome: number,
  opts?: { weight?: number }
): Promise<void> {
  if (!isEnabled()) return;
  const weight = opts?.weight ?? 1;
  try {
    const data = await loadStatsFile();
    const effortStats: EffortStatsFile = data.effort_stats ?? { version: 1, cells: {} };
    const cellKey = `${intent}:${effort}`;
    const prev = effortStats.cells[cellKey] ?? { count: 0, scoreSum: 0, lastAt: "" };
    effortStats.cells[cellKey] = {
      count: prev.count + weight,
      scoreSum: prev.scoreSum + outcome * weight,
      lastAt: new Date().toISOString(),
    };
    data.effort_stats = effortStats;
    await saveStatsFile(data);
  } catch {
    // non-fatal
  }
}

/**
 * Ground learned priors with eval-suite golden pass/fail (high-trust weight).
 */
export async function recordEvalScenarioOutcome(input: {
  scenario: string;
  passed: boolean;
  /** Optional intent to also bump production effort cells. */
  intentClass?: ReasoningIntentClass;
  effort?: ReasoningEffort;
}): Promise<void> {
  if (!evalOutcomeLearnEnabled()) return;
  const outcome = input.passed ? 1 : 0;
  const weight = 5;
  const scenarioKey = input.scenario.trim().slice(0, 80) || "unknown";

  try {
    const data = await loadStatsFile();
    const effortStats: EffortStatsFile = data.effort_stats ?? { version: 1, cells: {} };
    const evalCells = effortStats.eval_cells ?? {};
    const prev = evalCells[scenarioKey] ?? { count: 0, scoreSum: 0, lastAt: "" };
    evalCells[scenarioKey] = {
      count: prev.count + 1,
      scoreSum: prev.scoreSum + outcome,
      lastAt: new Date().toISOString(),
    };
    effortStats.eval_cells = evalCells;

    const cal = effortStats.calibration ?? {
      samples: 0,
      processSum: 0,
      refinedSum: 0,
      judgeSum: 0,
      judgeCount: 0,
      implicitSignalCount: 0,
      evalPass: 0,
      evalFail: 0,
    };
    effortStats.calibration = bumpCalibration(cal, {
      processScore: outcome,
      refinedScore: outcome,
      hadImplicit: false,
      evalPass: input.passed ? 1 : 0,
      evalFail: input.passed ? 0 : 1,
    });
    data.effort_stats = effortStats;
    await saveStatsFile(data);

    const intent = input.intentClass ?? inferEvalIntentFromScenario(scenarioKey);
    const effort = input.effort ?? "medium";
    await recordEffortOutcome(intent, effort, outcome, { weight });
  } catch {
    /* non-fatal */
  }
}

function inferEvalIntentFromScenario(name: string): ReasoningIntentClass {
  const n = name.toLowerCase();
  if (/memory|recall|retrieval|vault/.test(n)) return "knowledge";
  if (/reason|budget|epistemic/.test(n)) return "execution";
  if (/browser|web|research/.test(n)) return "research";
  if (/document|doc/.test(n)) return "creative";
  if (/harness|tool|lazy|write|file|lint/.test(n)) return "coding";
  return "conversational";
}

const EFFORT_ORDER: ReasoningEffort[] = ["none", "low", "medium", "high", "xhigh"];
const MIN_SAMPLES = 4;

/**
 * Returns the statistically best effort level for an intent class,
 * or null if there are insufficient samples to make a recommendation.
 */
export async function getBestEffortForIntent(
  intent: ReasoningIntentClass
): Promise<ReasoningEffort | null> {
  if (!isEnabled()) return null;
  try {
    const data = await loadStatsFile();
    const effortStats = data.effort_stats;
    if (!effortStats) return null;

    let bestEffort: ReasoningEffort | null = null;
    let bestScore = -Infinity;

    for (const effort of EFFORT_ORDER) {
      const cell = effortStats.cells[`${intent}:${effort}`];
      if (!cell || cell.count < MIN_SAMPLES) continue;
      const avgScore = cell.scoreSum / cell.count;
      if (avgScore > bestScore) {
        bestScore = avgScore;
        bestEffort = effort;
      }
    }

    return bestEffort;
  } catch {
    return null;
  }
}

/**
 * Format a summary of effort stats for debugging.
 */
export async function formatEffortStatsReport(): Promise<string> {
  try {
    const data = await loadStatsFile();
    const es = data.effort_stats;
    if (!es || Object.keys(es.cells).length === 0) return "(no effort stats yet)";
    const lines = ["[EFFORT STATS]"];
    for (const [key, cell] of Object.entries(es.cells)) {
      const avg = cell.count > 0 ? (cell.scoreSum / cell.count).toFixed(2) : "n/a";
      lines.push(`  ${key}: n=${cell.count} avg=${avg}`);
    }
    if (es.calibration && es.calibration.samples > 0) {
      const c = es.calibration;
      lines.push(
        `[OUTCOME CALIBRATION] n=${c.samples} process_avg=${(c.processSum / c.samples).toFixed(2)} ` +
          `refined_avg=${(c.refinedSum / c.samples).toFixed(2)} ` +
          `implicit_signals=${c.implicitSignalCount} eval_pass=${c.evalPass} eval_fail=${c.evalFail}`
      );
    }
    if (es.eval_cells && Object.keys(es.eval_cells).length > 0) {
      lines.push(`[EVAL GOLDEN] ${Object.keys(es.eval_cells).length} scenarios tracked`);
    }
    return lines.join("\n");
  } catch {
    return "(effort stats unavailable)";
  }
}

/**
 * Immediate learning path when deferred feedback is off — same record shape as apply.
 */
export async function recordImmediateTurnLearning(input: {
  processScore: number;
  intentClass: ReasoningIntentClass;
  effort?: ReasoningEffort;
  ruleIds: string[];
  recipeKey?: string;
  userGoal: string;
  assistantPreview: string;
  toolsUsed: string[];
  recipeEligible: boolean;
}): Promise<void> {
  const refined = refineTurnOutcome({
    processScore: input.processScore,
    implicitKind: "neutral",
    implicitScore: null,
    judgeScore: null,
  });
  const pending = buildPendingTurnLearning({
    processScore: input.processScore,
    intentClass: input.intentClass,
    effort: input.effort,
    ruleIds: input.ruleIds,
    recipeKey: input.recipeKey,
    userGoal: input.userGoal,
    assistantPreview: input.assistantPreview,
    toolOutcomes: [],
    toolsUsed: input.toolsUsed,
    recipeEligible: input.recipeEligible,
  });
  await recordTurnLearningOutcome({ pending, refined, judgeSampled: false });
}
