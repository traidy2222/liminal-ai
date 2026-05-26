/**
 * Turn outcome scorer + adaptive reasoning effort learning.
 *
 * Heuristically scores each send() outcome (0–1) from:
 *   - Tool success rate
 *   - Whether critic passed (if run)
 *   - Contradiction count in epistemic state
 *   - Round count vs tool success (efficiency)
 *
 * Writes (intent_class, effort_level, outcome) tuples to .agent_recipe_stats.json
 * under an "effort_stats" section. reasoning_profile.ts reads this to Bayesian-update
 * the default effort per intent class over time.
 *
 * Gate: AGENT_EFFORT_LEARN=1
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
// resolveWorkspaceRoot no longer used — stats file resolved via global_storage.
import { effectiveHarnessEnvRaw } from "./harness_effective_env.js";
import type { ReasoningEffort, ReasoningIntentClass } from "./reasoning_profile.js";

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
 * 1.0 = perfect; 0.0 = total failure.
 */
export function scoreTurnOutcome(input: TurnOutcomeInput): number {
  let score = 0.5; // neutral baseline

  const total = input.toolsUsed.length;
  if (total > 0) {
    const successRate = input.toolsUsed.filter((t) => t.ok).length / total;
    score += (successRate - 0.5) * 0.35; // ±0.175
  }

  // Penalize round cap / timeout / error exits
  if (input.terminationReason === "round_cap") score -= 0.15;
  if (input.terminationReason === "timeout") score -= 0.2;
  if (input.terminationReason === "error") score -= 0.25;

  // Reward clean round efficiency (few rounds, many successes)
  if (total > 0 && input.roundCount > 0) {
    const efficiency = Math.min(1, total / Math.max(input.roundCount, 1) / 3);
    score += efficiency * 0.1;
  }

  // Critic outcome
  if (input.criticPassed === true) score += 0.1;
  if (input.criticPassed === false) score -= 0.12;

  // Contradiction penalty
  const contraPenalty = Math.min(0.15, input.contradictionCount * 0.05);
  score -= contraPenalty;

  return Math.max(0, Math.min(1, score));
}

// ─── Effort stats persistence ─────────────────────────────────────────────────

interface EffortCell {
  count: number;
  scoreSum: number;
  lastAt: string;
}

interface EffortStatsFile {
  version: 1;
  cells: Record<string, EffortCell>; // key: `${intent}:${effort}`
}

async function loadStatsFile(): Promise<{ entries: Record<string, unknown>; effort_stats?: EffortStatsFile }> {
  try {
    const { recipeStatsPaths, pickReadPath } = await import("./global_storage.js");
    const p = await pickReadPath(recipeStatsPaths());
    const raw = await readFile(p, "utf8");
    return JSON.parse(raw) as { entries: Record<string, unknown>; effort_stats?: EffortStatsFile };
  } catch {
    return { entries: {} };
  }
}

async function saveStatsFile(data: { entries: Record<string, unknown>; effort_stats?: EffortStatsFile }): Promise<void> {
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

/**
 * Record an outcome for a (intent_class, effort_level) pair.
 * Silently no-ops if AGENT_EFFORT_LEARN is not "1".
 */
export async function recordEffortOutcome(
  intent: ReasoningIntentClass,
  effort: ReasoningEffort,
  outcome: number
): Promise<void> {
  if (!isEnabled()) return;
  try {
    const data = await loadStatsFile();
    const effortStats: EffortStatsFile = data.effort_stats ?? { version: 1, cells: {} };
    const cellKey = `${intent}:${effort}`;
    const prev = effortStats.cells[cellKey] ?? { count: 0, scoreSum: 0, lastAt: "" };
    effortStats.cells[cellKey] = {
      count: prev.count + 1,
      scoreSum: prev.scoreSum + outcome,
      lastAt: new Date().toISOString(),
    };
    data.effort_stats = effortStats;
    await saveStatsFile(data);
  } catch {
    // non-fatal
  }
}

const EFFORT_ORDER: ReasoningEffort[] = ["none", "low", "medium", "high", "xhigh"];
const MIN_SAMPLES = 4; // need at least this many samples before adapting

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
    return lines.join("\n");
  } catch {
    return "(effort stats unavailable)";
  }
}
