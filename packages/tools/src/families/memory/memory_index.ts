/**
 * On-disk embedding index for note keys (Phase 1 hybrid recall, federated in Phase 2).
 *
 * Phase 1 stored this under `<workspaceRoot>/.agent_memory.index.json` — a silent
 * bug after the per-chat scratch-workspace split, because every new chat
 * started with an empty index. Phase 2 moves the canonical location to
 * `~/.liminal/memory.index.json` so the embedding cache survives chat hops
 * and a single user has one cross-chat semantic substrate. The legacy
 * workspace-local file is read once at first access and migrated forward.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fetchEmbeddings, cosineSimilarity, memoryIndexPaths, pickReadPath, pickWritePath } from "@liminal/core";

/** Read path — prefers `~/.liminal/memory.index.json`, falls back to legacy. */
export async function memoryEmbedIndexReadPath(): Promise<string> {
  return pickReadPath(memoryIndexPaths());
}

/** Write path — always returns the global path; lazy-migrates legacy on first write. */
export async function memoryEmbedIndexWritePath(): Promise<string> {
  return pickWritePath(memoryIndexPaths());
}

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
    const raw = await readFile(await memoryEmbedIndexReadPath(), "utf8");
    const j = JSON.parse(raw) as MemoryEmbedIndex;
    if (j.version !== 1 || !j.entries) return { version: 1, model: "", entries: {} };
    return j;
  } catch {
    return { version: 1, model: "", entries: {} };
  }
}

export async function saveEmbedIndex(idx: MemoryEmbedIndex): Promise<void> {
  await writeFile(await memoryEmbedIndexWritePath(), JSON.stringify(idx, null, 2), "utf8");
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
