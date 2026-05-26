/**
 * PASTE pattern store — persistence + Top-k query.
 *
 * Patterns mined by `paste_pattern_miner.ts` are persisted to a single JSON
 * file under the user-global storage root so they outlive a workspace and
 * compound across projects. The store is keyed by `contextKey` (comma-joined
 * last-N tool names within a turn) and returns predictions ranked by
 * probability for a given context signature.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { ensureGlobalStorageRoot, globalPath } from "./global_storage.js";
import type { PatternRecord } from "./paste_pattern_miner.js";

/** File name under the global storage root. */
const PATTERN_FILE = "paste_patterns.json";

interface PatternFile {
  version: 1;
  /** When the file was last refreshed by the miner. */
  refreshedAt: string;
  /** Total patterns retained. */
  count: number;
  /** Pattern records, sorted by `probability` desc. */
  patterns: PatternRecord[];
}

export function patternStorePath(): string {
  return globalPath(PATTERN_FILE);
}

export async function loadPatternStore(): Promise<PatternFile | null> {
  try {
    const raw = await readFile(patternStorePath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray((parsed as PatternFile).patterns)
    ) {
      return parsed as PatternFile;
    }
    return null;
  } catch {
    return null;
  }
}

export async function savePatternStore(patterns: PatternRecord[]): Promise<string> {
  await ensureGlobalStorageRoot();
  const file: PatternFile = {
    version: 1,
    refreshedAt: new Date().toISOString(),
    count: patterns.length,
    patterns,
  };
  const target = patternStorePath();
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(file, null, 2), "utf8");
  return target;
}

/** Build a context key from the last-N tool names. */
export function buildContextKey(recentTools: readonly string[], window: number): string {
  if (window < 1 || recentTools.length === 0) return "";
  const slice =
    recentTools.length <= window
      ? recentTools
      : recentTools.slice(recentTools.length - window);
  return slice.join(",");
}

export interface PatternQueryResult {
  nextTool: string;
  probability: number;
  support: number;
  hits: number;
}

/**
 * Return the Top-k predictions for a given context window, filtered by minimum
 * probability. Pure function over an in-memory PatternFile to keep callers fast.
 */
export function queryPatterns(
  store: PatternFile,
  contextKey: string,
  options: { topK?: number; minProbability?: number } = {}
): PatternQueryResult[] {
  if (!contextKey) return [];
  const topK = Math.max(1, options.topK ?? 3);
  const minProb = Math.max(0, options.minProbability ?? 0);
  const matches = store.patterns.filter((p) => p.contextKey === contextKey);
  if (matches.length === 0) return [];
  matches.sort((a, b) => b.probability - a.probability);
  const out: PatternQueryResult[] = [];
  for (const m of matches) {
    if (m.probability < minProb) continue;
    out.push({
      nextTool: m.nextTool,
      probability: m.probability,
      support: m.support,
      hits: m.hits,
    });
    if (out.length >= topK) break;
  }
  return out;
}

/**
 * In-memory cached view of the pattern store. Loaders should call
 * `refreshPatternStoreCache()` after a miner run; readers can use
 * `getCachedPatternStore()` to avoid re-parsing JSON on every speculation.
 */
let cached: PatternFile | null = null;
let cacheLoadAttempted = false;

export async function getCachedPatternStore(): Promise<PatternFile | null> {
  if (cached) return cached;
  if (cacheLoadAttempted) return null;
  cacheLoadAttempted = true;
  cached = await loadPatternStore();
  return cached;
}

export function refreshPatternStoreCache(next: PatternFile | null): void {
  cached = next;
  cacheLoadAttempted = true;
}

/** Convenience: read store, build context key, return predictions. Used by the scheduler. */
export async function predictNextTools(
  recentTools: readonly string[],
  options: {
    window?: number;
    topK?: number;
    minProbability?: number;
  } = {}
): Promise<PatternQueryResult[]> {
  const store = await getCachedPatternStore();
  if (!store) return [];
  const window = Math.max(1, options.window ?? 2);
  const ctx = buildContextKey(recentTools, window);
  return queryPatterns(store, ctx, {
    topK: options.topK,
    minProbability: options.minProbability,
  });
}
