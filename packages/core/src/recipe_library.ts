/**
 * Voyager-style recipe success counters for session hints.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { rankDocumentsForQuery, type RankableDoc } from "./memory_rank.js";
import { resolveWorkspaceRoot } from "./workspace_root.js";
import { effectiveHarnessEnvRaw } from "./harness_effective_env.js";

const STATS_PATH = () => join(resolveWorkspaceRoot(), ".agent_recipe_stats.json");

type StatsFile = { entries: Record<string, { count: number; preview: string; lastAt: string }> };

async function loadStats(): Promise<StatsFile> {
  try {
    const raw = await readFile(STATS_PATH(), "utf8");
    const j = JSON.parse(raw) as StatsFile;
    if (!j.entries || typeof j.entries !== "object") return { entries: {} };
    return j;
  } catch {
    return { entries: {} };
  }
}

async function saveStats(s: StatsFile): Promise<void> {
  await mkdir(resolveWorkspaceRoot(), { recursive: true });
  await writeFile(STATS_PATH(), JSON.stringify(s, null, 2), "utf8");
}

/** Bump success count when harness persists a recipe:* note. */
export async function bumpRecipePattern(preview: string): Promise<void> {
  if (effectiveHarnessEnvRaw("AGENT_RECIPE_LIBRARY") === "0") return;
  const key = preview.replace(/\s+/g, " ").trim().slice(0, 200);
  if (key.length < 12) return;
  const s = await loadStats();
  const id = createHash("sha256").update(key).digest("hex").slice(0, 20);
  const prev = s.entries[id];
  s.entries[id] = {
    count: (prev?.count ?? 0) + 1,
    preview: key.slice(0, 400),
    lastAt: new Date().toISOString(),
  };
  await saveStats(s);
}

export async function formatRecipeLibraryHints(seed: string): Promise<string | null> {
  if (effectiveHarnessEnvRaw("AGENT_RECIPE_LIBRARY") === "0") return null;
  const trimmed = seed.trim();
  if (trimmed.length < 6) return null;
  const s = await loadStats();
  const entries = Object.values(s.entries);
  if (entries.length === 0) return null;
  entries.sort((a, b) => b.count - a.count);
  const docs: RankableDoc[] = entries.map((e, i) => ({
    id: String(i),
    text: `${e.preview} count=${e.count}`,
  }));
  const ranked = rankDocumentsForQuery(trimmed, docs, { limit: 4 });
  const lines = ["[KNOWN RECIPE] high-reuse tool patterns (ranked to your goal):"];
  for (const h of ranked) {
    const e = entries[parseInt(h.id, 10)];
    if (!e) continue;
    lines.push(`  - (×${e.count}) ${e.preview.slice(0, 160)}${e.preview.length > 160 ? "…" : ""}`);
  }
  return lines.join("\n");
}
