/**
 * On-disk embedding index for vault notes (federation Phase 2).
 *
 * Mirror of memory_index.ts but keyed by vault slug (a stable URL-safe id for
 * each markdown file in the Obsidian-style vault). The vault is the place
 * consolidated cross-chat knowledge lands — without a semantic index, it's
 * BM25-only and effectively unsearchable by paraphrase. This module fixes that.
 *
 * Storage: `~/.liminal/vault.index.json` (user-global, like the vault itself).
 * Embedding shape mirrors notes: per-entry sha256 of body content + dim + vec.
 * Body re-hashes guard against re-embedding on no-op writes (same logic as
 * memory_index — see `hashNoteValue`).
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { cosineSimilarity, fetchEmbeddings, vaultIndexPaths, pickReadPath, pickWritePath } from "@liminal/core";

export async function vaultIndexReadPath(): Promise<string> {
  return pickReadPath(vaultIndexPaths());
}

export async function vaultIndexWritePath(): Promise<string> {
  return pickWritePath(vaultIndexPaths());
}

export interface VaultEmbedRow {
  hash: string;
  dim: number;
  v: number[];
  title: string;
  type: string;
}

export interface VaultEmbedIndex {
  version: 1;
  model: string;
  /** Key: vault slug (titleToSlug output). */
  entries: Record<string, VaultEmbedRow>;
}

export function hashVaultBody(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 32);
}

export async function loadVaultEmbedIndex(): Promise<VaultEmbedIndex> {
  try {
    const raw = await readFile(await vaultIndexReadPath(), "utf8");
    const j = JSON.parse(raw) as VaultEmbedIndex;
    if (j.version !== 1 || !j.entries) return { version: 1, model: "", entries: {} };
    return j;
  } catch {
    return { version: 1, model: "", entries: {} };
  }
}

export async function saveVaultEmbedIndex(idx: VaultEmbedIndex): Promise<void> {
  await writeFile(await vaultIndexWritePath(), JSON.stringify(idx, null, 2), "utf8");
}

/**
 * Upsert embeddings for vault notes whose body hash changed. Caller provides a
 * pre-filtered list of notes (slug, title, type, body) to keep this module
 * decoupled from vault_store internals.
 */
export async function upsertVaultEmbeddings(params: {
  apiKey: string;
  baseURL: string;
  model: string;
  notes: Array<{ slug: string; title: string; type: string; body: string }>;
}): Promise<{ updated: number; total: number }> {
  const idx = await loadVaultEmbedIndex();
  const toEmbed: string[] = [];
  const slugs: string[] = [];
  const meta: Array<{ title: string; type: string; hash: string }> = [];
  for (const n of params.notes) {
    const text = `${n.title}\n\n${n.body}`.slice(0, 8000);
    const h = hashVaultBody(text);
    const row = idx.entries[n.slug];
    if (row && row.hash === h && row.v.length > 0) continue;
    slugs.push(n.slug);
    toEmbed.push(text);
    meta.push({ title: n.title, type: n.type, hash: h });
  }
  if (slugs.length === 0) return { updated: 0, total: Object.keys(idx.entries).length };

  const { vectors } = await fetchEmbeddings({
    apiKey: params.apiKey,
    baseURL: params.baseURL,
    model: params.model,
    inputs: toEmbed,
  });
  for (let i = 0; i < slugs.length; i++) {
    const s = slugs[i]!;
    const m = meta[i]!;
    const v = vectors[i]!;
    idx.entries[s] = { hash: m.hash, dim: v.length, v, title: m.title, type: m.type };
  }
  idx.model = params.model;
  await saveVaultEmbedIndex(idx);
  return { updated: slugs.length, total: Object.keys(idx.entries).length };
}

export function embedQueryAgainstVaultIndex(
  queryVec: number[],
  idx: VaultEmbedIndex,
  limit: number
): Array<{ slug: string; title: string; type: string; score: number }> {
  const out: Array<{ slug: string; title: string; type: string; score: number }> = [];
  for (const [slug, row] of Object.entries(idx.entries)) {
    if (!row.v.length) continue;
    const s = cosineSimilarity(queryVec, row.v);
    if (s > 0) out.push({ slug, title: row.title, type: row.type, score: s });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

/** Remove rows whose slug no longer exists in the vault (keeps index bounded). */
export function pruneOrphanVaultEntries(idx: VaultEmbedIndex, liveSlugs: Set<string>): number {
  let removed = 0;
  for (const k of Object.keys(idx.entries)) {
    if (!liveSlugs.has(k)) {
      delete idx.entries[k];
      removed++;
    }
  }
  return removed;
}
