/**
 * Rule effectiveness tracking — logs which R-* rules fire and how often they
 * prevent errors. Stats persisted to `.agent_rule_stats.json`.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveWorkspaceRoot } from "./workspace_root.js";
import { effectiveHarnessEnvRaw } from "./harness_effective_env.js";

export function ruleStatsPath(): string {
  return join(resolveWorkspaceRoot(), ".agent_rule_stats.json");
}

export interface RuleStatEntry {
  ruleId: string;
  hitCount: number;
  preventedErrorCount: number;
  /** Sum of turn-outcome scores [0,1] for turns where this rule was injected. */
  outcomeSum?: number;
  /** Number of scored turns contributing to outcomeSum. */
  outcomeCount?: number;
  lastHitAt: number;
}

export interface RuleStats {
  version: 1;
  updatedAt: number;
  rules: Record<string, RuleStatEntry>;
}

async function loadRuleStats(): Promise<RuleStats> {
  try {
    const raw = await readFile(ruleStatsPath(), "utf8");
    const j = JSON.parse(raw) as RuleStats;
    if (j.version !== 1 || !j.rules) return { version: 1, updatedAt: Date.now(), rules: {} };
    return j;
  } catch {
    return { version: 1, updatedAt: Date.now(), rules: {} };
  }
}

async function saveRuleStats(stats: RuleStats): Promise<void> {
  await writeFile(ruleStatsPath(), JSON.stringify(stats, null, 2), "utf8");
}

/** Rule ID pattern — matches R-UPPERCASE or R-MIXED identifiers. */
const RULE_ID_RE = /\bR-[A-Z0-9][A-Z0-9_-]+\b/g;

/** Extract all rule IDs mentioned in a block of text. */
export function extractRuleIds(text: string): string[] {
  return [...new Set(text.match(RULE_ID_RE) ?? [])];
}

/**
 * Bump hit count for each rule ID found in `context`.
 * If `preventedError` is true, also bumps the preventedErrorCount.
 */
export async function bumpRuleHits(context: string, preventedError = false): Promise<void> {
  const ids = extractRuleIds(context);
  if (ids.length === 0) return;
  try {
    const stats = await loadRuleStats();
    const now = Date.now();
    for (const id of ids) {
      const existing = stats.rules[id] ?? {
        ruleId: id,
        hitCount: 0,
        preventedErrorCount: 0,
        lastHitAt: now,
      };
      existing.hitCount += 1;
      if (preventedError) existing.preventedErrorCount += 1;
      existing.lastHitAt = now;
      stats.rules[id] = existing;
    }
    stats.updatedAt = now;
    await saveRuleStats(stats);
  } catch {
    /* non-fatal */
  }
}

/**
 * Record the turn-outcome score against each rule that was injected this turn.
 * This is the real effectiveness signal: rules that ride with high-outcome turns
 * are pulling weight; rules that ride with low-outcome turns are ceremonial.
 * `outcome` is the [0,1] score from `scoreTurnOutcome`.
 */
export async function recordRuleOutcomes(ruleIds: string[], outcome: number): Promise<void> {
  const ids = extractRuleIds(ruleIds.join(" "));
  if (ids.length === 0) return;
  const clamped = Math.max(0, Math.min(1, outcome));
  try {
    const stats = await loadRuleStats();
    const now = Date.now();
    for (const id of ids) {
      const existing = stats.rules[id] ?? {
        ruleId: id,
        hitCount: 0,
        preventedErrorCount: 0,
        outcomeSum: 0,
        outcomeCount: 0,
        lastHitAt: now,
      };
      existing.hitCount += 1;
      existing.outcomeSum = (existing.outcomeSum ?? 0) + clamped;
      existing.outcomeCount = (existing.outcomeCount ?? 0) + 1;
      existing.lastHitAt = now;
      stats.rules[id] = existing;
    }
    stats.updatedAt = now;
    await saveRuleStats(stats);
  } catch {
    /* non-fatal */
  }
}

// ─── Auto-demotion of low-effectiveness rules ────────────────────────────────

const DEFAULT_DEMOTE_THRESHOLD = 0.4;
const DEFAULT_DEMOTE_MIN_SAMPLES = 20;

function resolveDemoteParams(): { threshold: number; minSamples: number } {
  const tRaw = effectiveHarnessEnvRaw("AGENT_RULE_DEMOTE_THRESHOLD");
  const nRaw = effectiveHarnessEnvRaw("AGENT_RULE_DEMOTE_MIN_SAMPLES");
  const t = tRaw ? parseFloat(tRaw) : NaN;
  const n = nRaw ? parseInt(nRaw, 10) : NaN;
  return {
    threshold: Number.isFinite(t) && t >= 0 && t <= 1 ? t : DEFAULT_DEMOTE_THRESHOLD,
    minSamples: Number.isFinite(n) && n > 0 ? n : DEFAULT_DEMOTE_MIN_SAMPLES,
  };
}

/**
 * Rule IDs that should be excluded from the round-2 recall because their
 * avg_outcome is consistently low over a meaningful sample. The rule remains
 * in stats and self_telemetry — only the recall message hides it.
 */
export async function getDemotedRuleIds(): Promise<Set<string>> {
  try {
    const { threshold, minSamples } = resolveDemoteParams();
    const stats = await loadRuleStats();
    const out = new Set<string>();
    for (const entry of Object.values(stats.rules)) {
      const oc = entry.outcomeCount ?? 0;
      if (oc < minSamples) continue;
      const avg = (entry.outcomeSum ?? 0) / oc;
      if (avg < threshold) out.add(entry.ruleId);
    }
    return out;
  } catch {
    return new Set<string>();
  }
}

/** Return a map of ruleId → hitCount for adaptive rule injection. */
export async function getRuleHitCounts(): Promise<Map<string, number>> {
  try {
    const stats = await loadRuleStats();
    const out = new Map<string, number>();
    for (const [id, entry] of Object.entries(stats.rules)) {
      out.set(id, entry.hitCount);
    }
    return out;
  } catch {
    return new Map();
  }
}

/**
 * Format rule stats for display (e.g. in world context or suggest_improvement).
 * Returns top N rules by hit count with effectiveness ratio.
 */
export async function formatRuleStatsReport(topN = 10): Promise<string> {
  try {
    const stats = await loadRuleStats();
    const demoted = await getDemotedRuleIds();
    const entries = Object.values(stats.rules)
      .sort((a, b) => b.hitCount - a.hitCount)
      .slice(0, topN);
    if (entries.length === 0) return "(no rule stats yet)";
    const lines = entries.map((e) => {
      const oc = e.outcomeCount ?? 0;
      const avg = oc > 0 ? ((e.outcomeSum ?? 0) / oc).toFixed(2) : "n/a";
      const tag = demoted.has(e.ruleId) ? " [auto-demoted: low avg, hidden from recall]" : "";
      return `  ${e.ruleId}: turns=${e.hitCount} avg_outcome=${avg} (n=${oc}) last=${new Date(e.lastHitAt).toISOString().slice(0, 10)}${tag}`;
    });
    return `Rule effectiveness — avg turn-outcome [0–1] of turns where the rule was injected (top ${topN} by use):\n${lines.join("\n")}`;
  } catch {
    return "(rule stats unavailable)";
  }
}
