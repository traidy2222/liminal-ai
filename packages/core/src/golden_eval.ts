/**
 * Persist passing eval traces and surface nearest-neighbor hints at session start.
 */
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { rankDocumentsForQuery, type RankableDoc } from "./memory_rank.js";
import { resolveWorkspaceRoot } from "./workspace_root.js";

const GOLDEN_DIR = () => join(resolveWorkspaceRoot(), ".agent_eval_runs", "golden");
const GOLDEN_FILE = () => join(GOLDEN_DIR(), "traces.jsonl");

export interface GoldenEvalRecord {
  scenario: string;
  prompt: string;
  distinctTools: string[];
  durationMs: number;
  at: string;
}

export async function appendGoldenEvalRecord(entry: Omit<GoldenEvalRecord, "at">): Promise<void> {
  if (process.env["AGENT_GOLDEN_EVAL"] === "0") return;
  try {
    await mkdir(GOLDEN_DIR(), { recursive: true });
    const row: GoldenEvalRecord = { ...entry, at: new Date().toISOString() };
    await appendFile(GOLDEN_FILE(), JSON.stringify(row) + "\n", "utf8");
  } catch {
    /* optional */
  }
}

export async function formatGoldenEvalHints(seed: string): Promise<string | null> {
  if (process.env["AGENT_GOLDEN_EVAL"] === "0") return null;
  const trimmed = seed.trim();
  if (trimmed.length < 8) return null;
  let raw: string;
  try {
    raw = await readFile(GOLDEN_FILE(), "utf8");
  } catch {
    return null;
  }
  const rows: GoldenEvalRecord[] = [];
  for (const line of raw.split("\n").filter(Boolean)) {
    try {
      rows.push(JSON.parse(line) as GoldenEvalRecord);
    } catch {
      /* skip */
    }
  }
  if (rows.length === 0) return null;
  const docs: RankableDoc[] = rows.map((r, i) => ({
    id: String(i),
    text: `${r.scenario} ${r.prompt} ${r.distinctTools.join(" ")}`,
  }));
  const ranked = rankDocumentsForQuery(trimmed, docs, { limit: 3 });
  if (ranked.length === 0) return null;
  const parts: string[] = ["Nearest passing eval demos (for in-context pattern hints):"];
  for (const hit of ranked) {
    const r = rows[parseInt(hit.id, 10)];
    if (!r) continue;
    parts.push(
      `- [${r.scenario}] tools: ${r.distinctTools.slice(0, 12).join(", ")} (${r.durationMs}ms)`
    );
  }
  return parts.join("\n");
}
