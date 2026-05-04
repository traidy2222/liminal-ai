/**
 * On-disk embedding index for `.agent_notes.json` keys (Phase 1 hybrid recall).
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fetchEmbeddings, cosineSimilarity } from "@liminal/core";

export const MEMORY_EMBED_INDEX_PATH = join(process.cwd(), ".agent_memory.index.json");

export interface NoteEmbedRow {
  hash: string;
  dim: number;
  v: number[];
}

export interface MemoryEmbedIndex {
  version: 1;
  model: string;
  entries: Record<string, NoteEmbedRow>;
}

export function hashNoteValue(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 32);
}

export async function loadEmbedIndex(): Promise<MemoryEmbedIndex> {
  try {
    const raw = await readFile(MEMORY_EMBED_INDEX_PATH, "utf8");
    const j = JSON.parse(raw) as MemoryEmbedIndex;
    if (j.version !== 1 || !j.entries) return { version: 1, model: "", entries: {} };
    return j;
  } catch {
    return { version: 1, model: "", entries: {} };
  }
}

export async function saveEmbedIndex(idx: MemoryEmbedIndex): Promise<void> {
  await writeFile(MEMORY_EMBED_INDEX_PATH, JSON.stringify(idx, null, 2), "utf8");
}

/** Upsert embeddings for keys whose value hash changed. */
export async function upsertNoteEmbeddings(params: {
  apiKey: string;
  baseURL: string;
  model: string;
  notes: Record<string, string>;
}): Promise<void> {
  const idx = await loadEmbedIndex();
  const toEmbed: string[] = [];
  const keys: string[] = [];
  for (const [k, v] of Object.entries(params.notes)) {
    const h = hashNoteValue(v);
    const row = idx.entries[k];
    if (row && row.hash === h && row.v.length > 0) continue;
    keys.push(k);
    toEmbed.push(`${k}\n${v}`.slice(0, 8000));
  }
  if (keys.length === 0) return;

  const { vectors } = await fetchEmbeddings({
    apiKey: params.apiKey,
    baseURL: params.baseURL,
    model: params.model,
    inputs: toEmbed,
  });

  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]!;
    const v = vectors[i]!;
    idx.entries[k] = {
      hash: hashNoteValue(params.notes[k]!),
      dim: v.length,
      v,
    };
  }
  idx.model = params.model;
  await saveEmbedIndex(idx);
}

export function embedQueryAgainstIndex(
  queryVec: number[],
  idx: MemoryEmbedIndex,
  limit: number
): Array<{ key: string; score: number }> {
  const out: Array<{ key: string; score: number }> = [];
  for (const [key, row] of Object.entries(idx.entries)) {
    if (!row.v.length) continue;
    const s = cosineSimilarity(queryVec, row.v);
    if (s > 0) out.push({ key, score: s });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

/** Remove index rows whose key no longer exists in notes (keeps index bounded / consistent). */
export function pruneOrphanEmbeddingKeys(idx: MemoryEmbedIndex, noteKeys: Set<string>): number {
  let removed = 0;
  for (const k of Object.keys(idx.entries)) {
    if (!noteKeys.has(k)) {
      delete idx.entries[k];
      removed++;
    }
  }
  return removed;
}
