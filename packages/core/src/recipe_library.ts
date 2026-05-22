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

/**
 * Bump the success count for a recipe.
 *
 * `signature` is the dedupe key — pass a *generalizable* value (a tool-call
 * sequence), NOT task-specific prose, so structurally-similar runs collide on
 * the same entry and the count compounds instead of every recipe sitting at ×1.
 * `preview` is the human-readable text shown in hints (defaults to `signature`).
 */
export async function bumpRecipePattern(signature: string, preview?: string): Promise<void> {
  if (effectiveHarnessEnvRaw("AGENT_RECIPE_LIBRARY") === "0") return;
  const sig = signature.replace(/\s+/g, " ").trim().slice(0, 200);
  if (sig.length < 8) return;
  const s = await loadStats();
  const id = createHash("sha256").update(sig).digest("hex").slice(0, 20);
  const prev = s.entries[id];
  s.entries[id] = {
    count: (prev?.count ?? 0) + 1,
    preview: (preview ?? sig).replace(/\s+/g, " ").trim().slice(0, 400),
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

/**
 * List the top recipe patterns by reuse count, no seed/ranking required.
 * Used by the `self_telemetry` tool so the model can inspect its own recipe library.
 */
export async function formatTopRecipes(topN = 10): Promise<string> {
  try {
    const s = await loadStats();
    const entries = Object.values(s.entries);
    if (entries.length === 0) return "(no recipes recorded yet)";
    entries.sort((a, b) => b.count - a.count);
    const top = entries.slice(0, Math.max(1, topN));
    const lines = [`[RECIPE LIBRARY] top ${top.length} reused tool patterns (of ${entries.length}):`];
    for (const e of top) {
      lines.push(
        `  - (×${e.count}) ${e.preview.slice(0, 180)}${e.preview.length > 180 ? "…" : ""}`
      );
    }
    return lines.join("\n");
  } catch {
    return "(recipe library unavailable)";
  }
}
