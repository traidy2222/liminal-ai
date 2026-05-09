/**
 * Rule effectiveness tracking — logs which R-* rules fire and how often they
 * prevent errors. Stats persisted to `.agent_rule_stats.json`.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveWorkspaceRoot } from "./workspace_root.js";

export function ruleStatsPath(): string {
  return join(resolveWorkspaceRoot(), ".agent_rule_stats.json");
}

export interface RuleStatEntry {
  ruleId: string;
  hitCount: number;
  preventedErrorCount: number;
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
    const entries = Object.values(stats.rules)
      .sort((a, b) => b.hitCount - a.hitCount)
      .slice(0, topN);
    if (entries.length === 0) return "(no rule stats yet)";
    const lines = entries.map((e) => {
      const effectiveness =
        e.hitCount > 0 ? ((e.preventedErrorCount / e.hitCount) * 100).toFixed(0) : "0";
      return `  ${e.ruleId}: hits=${e.hitCount} errors_prevented=${e.preventedErrorCount} (${effectiveness}%) last=${new Date(e.lastHitAt).toISOString().slice(0, 10)}`;
    });
    return `Rule effectiveness (top ${topN}):\n${lines.join("\n")}`;
  } catch {
    return "(rule stats unavailable)";
  }
}
