/**
 * Vault store — reads and writes Obsidian-compatible markdown notes.
 *
 * Vault root: `AGENT_VAULT_PATH` (env or runtime prefs) wins when set. Otherwise, when
 * `AGENT_OBSIDIAN_DISCOVER` is not `0`, core tries Obsidian’s global `obsidian.json`
 * and uses a vault only when the pick is unambiguous (see CLAUDE.md). Fallback:
 * `~/.agent_vault`.
 *
 * Notes are stored as standard Obsidian markdown files with YAML frontmatter.
 * Folder layout mirrors note type:
 *   Facts/  Entities/  Reflections/  Recipes/  Tasks/  Notes/  Episodes/
 */

import { readFile, writeFile, mkdir, readdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname } from "node:path";
import {
  getAgentVaultRoot,
  getExplicitAgentVaultPathFromEnv,
  rankDocumentsForQuery,
  type RankableDoc,
} from "@liminal/core";

// ─── Vault path (configurable) ───────────────────────────────────────────────

export function getVaultDir(): string {
  return getAgentVaultRoot();
}

/** Map note type → subfolder name inside vault */
const TYPE_FOLDER: Record<NoteType, string> = {
  fact:       "Facts",
  entity:     "Entities",
  reflection: "Reflections",
  recipe:     "Recipes",
  task:       "Tasks",
  note:       "Notes",
  episode:    "Episodes",
};

// ─── Types ───────────────────────────────────────────────────────────────────

export type NoteType =
  | "fact"
  | "entity"
  | "reflection"
  | "recipe"
  | "task"
  | "note"
  | "episode";

export interface NoteFrontmatter {
  title: string;
  type: NoteType;
  tags: string[];
  created: string;  // ISO 8601
  updated: string;  // ISO 8601
}

export interface VaultNote extends NoteFrontmatter {
  body: string;       // markdown body (after frontmatter)
  slug: string;       // filename without .md
  filePath: string;   // absolute path
}

// ─── Slug / path helpers ──────────────────────────────────────────────────────

export function titleToSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function noteFilePath(type: NoteType, slug: string): string {
  return join(getVaultDir(), TYPE_FOLDER[type], `${slug}.md`);
}

async function ensureVaultFolders(): Promise<void> {
  const vault = getVaultDir();
  for (const folder of Object.values(TYPE_FOLDER)) {
    const dir = join(vault, folder);
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  }
}

// ─── Frontmatter serialisation ────────────────────────────────────────────────

function serializeFrontmatter(fm: NoteFrontmatter): string {
  const tags = fm.tags.length > 0 ? `[${fm.tags.join(", ")}]` : "[]";
  return [
    "---",
    `title: "${fm.title.replace(/"/g, '\\"')}"`,
    `type: ${fm.type}`,
    `tags: ${tags}`,
    `created: ${fm.created}`,
    `updated: ${fm.updated}`,
    "---",
  ].join("\n");
}

function parseFrontmatter(raw: string): { fm: Partial<NoteFrontmatter>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { fm: {}, body: raw };

  const yamlStr = match[1]!;
  const body = (match[2] ?? "").trim();
  const fm: Record<string, unknown> = {};

  for (const line of yamlStr.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx < 0) continue;
    const key = line.slice(0, colonIdx).trim();
    const raw = line.slice(colonIdx + 1).trim();
    if (key === "tags") {
      // Support both [a, b] inline and yaml list (- item) formats
      if (raw.startsWith("[")) {
        fm[key] = raw
          .slice(1, -1)
          .split(",")
          .map((s) => s.trim().replace(/^["']|["']$/g, ""))
          .filter(Boolean);
      } else if (!raw) {
        fm[key] = [];
      } else {
        fm[key] = [raw.replace(/^["']|["']$/g, "")];
      }
    } else {
      fm[key] = raw.replace(/^["']|["']$/g, "");
    }
  }

  return { fm: fm as Partial<NoteFrontmatter>, body };
}

// ─── Core read / write ────────────────────────────────────────────────────────

/** Read a note by its type and slug. Returns null if not found. */
export async function readNoteBySlug(type: NoteType, slug: string): Promise<VaultNote | null> {
  const filePath = noteFilePath(type, slug);
  try {
    const raw = await readFile(filePath, "utf8");
    const { fm, body } = parseFrontmatter(raw);
    return {
      title:   fm.title   ?? slug,
      type:    fm.type    ?? type,
      tags:    fm.tags    ?? [],
      created: fm.created ?? new Date().toISOString(),
      updated: fm.updated ?? new Date().toISOString(),
      body,
      slug,
      filePath,
    };
  } catch {
    return null;
  }
}

/** Find a note by title across all type folders (slug match → title match). */
export async function findNote(title: string): Promise<VaultNote | null> {
  const slug = titleToSlug(title);

  // 1. Try exact slug in every type folder
  for (const type of Object.keys(TYPE_FOLDER) as NoteType[]) {
    const note = await readNoteBySlug(type, slug);
    if (note) return note;
  }

  // 2. Case-insensitive title scan
  const titleLower = title.toLowerCase();
  const allNotes = await listAllNotes();
  return allNotes.find((n) => n.title.toLowerCase() === titleLower) ?? null;
}

/** Write a note (create or update), preserving `created` timestamp. */
export async function writeVaultNote(params: {
  title: string;
  body: string;
  type: NoteType;
  tags?: string[];
}): Promise<{ slug: string; filePath: string; wasCreated: boolean }> {
  await ensureVaultFolders();

  const slug = titleToSlug(params.title);
  const filePath = noteFilePath(params.type, slug);
  const existing = await readNoteBySlug(params.type, slug);
  const now = new Date().toISOString();

  const fm: NoteFrontmatter = {
    title:   params.title,
    type:    params.type,
    tags:    params.tags ?? [],
    created: existing?.created ?? now,
    updated: now,
  };

  const fileContent = `${serializeFrontmatter(fm)}\n\n${params.body.trimEnd()}\n`;
  await writeFile(filePath, fileContent, "utf8");

  return { slug, filePath, wasCreated: !existing };
}

/** Permanently delete a note. Returns false if not found. */
export async function deleteVaultNote(title: string): Promise<boolean> {
  const note = await findNote(title);
  if (!note) return false;
  await unlink(note.filePath);
  return true;
}

// ─── List / search ────────────────────────────────────────────────────────────

/** Scan all type folders and return every valid .md note. Sorted by updated desc. */
export async function listAllNotes(opts?: {
  type?: NoteType;
  tag?: string;
  limit?: number;
}): Promise<VaultNote[]> {
  await ensureVaultFolders();
  const vault = getVaultDir();
  const notes: VaultNote[] = [];

  const typesToScan: NoteType[] = opts?.type
    ? [opts.type]
    : (Object.keys(TYPE_FOLDER) as NoteType[]);

  for (const type of typesToScan) {
    const dir = join(vault, TYPE_FOLDER[type]);
    const files = await readdir(dir).catch(() => []);
    for (const file of files) {
      if (extname(file) !== ".md") continue;
      const slug = file.slice(0, -3);
      const note = await readNoteBySlug(type, slug);
      if (!note) continue;
      if (opts?.tag && !note.tags.includes(opts.tag)) continue;
      notes.push(note);
    }
  }

  notes.sort((a, b) => b.updated.localeCompare(a.updated));
  return opts?.limit ? notes.slice(0, opts.limit) : notes;
}

/** Full-text + metadata search across the vault (BM25-lite + recency + type). */
export async function searchVault(
  query: string,
  opts?: { type?: NoteType; tag?: string }
): Promise<Array<{ note: VaultNote; snippet: string }>> {
  const notes = await listAllNotes({ type: opts?.type, tag: opts?.tag });
  const q = query.trim();
  if (!q) return [];

  const docs: RankableDoc[] = notes.map((note) => ({
    id: note.slug,
    text: `${note.title} ${note.tags.join(" ")} ${note.body}`,
    updatedAt: note.updated,
    memoryType: note.type,
  }));

  const ranked = rankDocumentsForQuery(q, docs, { limit: 80 });
  const bySlug = new Map(notes.map((n) => [n.slug, n] as const));

  const buildSnippet = (note: VaultNote, needle: string): string => {
    const hay = note.body.toLowerCase();
    const low = needle.toLowerCase();
    let idx = hay.indexOf(low);
    if (idx < 0) {
      const toks = low.split(/\s+/).filter((t) => t.length > 1);
      for (const t of toks) {
        idx = hay.indexOf(t);
        if (idx >= 0) break;
      }
    }
    if (idx < 0) idx = 0;
    const bodyStart = Math.max(0, idx - 60);
    const bodyEnd = Math.min(note.body.length, idx + 120);
    return `...${note.body.slice(bodyStart, bodyEnd).replace(/\n/g, " ").trim()}...`;
  };

  if (ranked.length === 0) {
    const qLower = q.toLowerCase();
    const fallback: Array<{ note: VaultNote; snippet: string }> = [];
    for (const note of notes) {
      const haystack = `${note.title} ${note.tags.join(" ")} ${note.body}`.toLowerCase();
      if (!haystack.includes(qLower)) continue;
      fallback.push({ note, snippet: buildSnippet(note, q) });
    }
    return fallback;
  }

  return ranked
    .map((r) => {
      const note = bySlug.get(r.id);
      if (!note) return null;
      return { note, snippet: buildSnippet(note, q) };
    })
    .filter((x): x is { note: VaultNote; snippet: string } => x !== null);
}

export async function findNearDuplicateNote(
  title: string,
  body: string,
  opts?: { limit?: number; threshold?: number }
): Promise<Array<{ note: VaultNote; score: number }>> {
  const incomingSlug = titleToSlug(title);
  const titleLower = title.trim().toLowerCase();
  const notes = (await listAllNotes({ limit: 500 })).filter(
    (n) => titleToSlug(n.title) !== incomingSlug && n.title.toLowerCase() !== titleLower
  );
  if (notes.length === 0) return [];
  const query = `${title} ${body.slice(0, 800)}`.trim();
  const docs: RankableDoc[] = notes.map((note) => ({
    id: note.slug,
    text: `${note.title} ${note.tags.join(" ")} ${note.body.slice(0, 2500)}`,
    updatedAt: note.updated,
    memoryType: note.type,
  }));
  const ranked = rankDocumentsForQuery(query, docs, {
    limit: Math.max(1, Math.min(20, opts?.limit ?? 5)),
  });
  const threshold = opts?.threshold ?? 0.42;
  const bySlug = new Map(notes.map((n) => [n.slug, n] as const));
  return ranked
    .filter((r) => r.score >= threshold)
    .map((r) => ({ note: bySlug.get(r.id)!, score: r.score }))
    .filter((x) => !!x.note);
}

// ─── Wikilinks ────────────────────────────────────────────────────────────────

/** Extract all [[Wikilinks]] from text (deduped). */
export function extractWikilinks(text: string): string[] {
  const matches = [...text.matchAll(/\[\[([^\]|]+?)(?:\|[^\]]+)?\]\]/g)];
  return [...new Set(matches.map((m) => m[1]!.trim()))];
}

/** Find all notes that contain a [[Wikilink]] pointing to `title`. */
export async function getBacklinks(title: string): Promise<VaultNote[]> {
  const notes = await listAllNotes();
  const titleLower = title.toLowerCase();
  const titleSlug = titleToSlug(title);

  return notes.filter((n) => {
    const links = extractWikilinks(n.body).map((l) => l.toLowerCase());
    return links.some(
      (l) => l === titleLower || titleToSlug(l) === titleSlug
    );
  });
}

// ─── Graph traversal ─────────────────────────────────────────────────────────

export interface GraphNode {
  note: VaultNote;
  depth: number;
  forwardLinks: string[];
  backlinks: string[];
}

/**
 * BFS from `startTitle` following wikilinks in both directions.
 * Returns a Map of title → GraphNode, bounded by `maxDepth`.
 */
export async function traverseGraph(
  startTitle: string,
  maxDepth = 2
): Promise<Map<string, GraphNode>> {
  const visited = new Map<string, GraphNode>();
  const queue: Array<{ title: string; depth: number }> = [
    { title: startTitle, depth: 0 },
  ];

  while (queue.length > 0) {
    const item = queue.shift()!;
    const key = item.title.toLowerCase();
    if (item.depth > maxDepth || visited.has(key)) continue;

    const note = await findNote(item.title);
    if (!note) continue;

    const forwardLinks = extractWikilinks(note.body);
    const backlinks = await getBacklinks(note.title);

    visited.set(key, {
      note,
      depth: item.depth,
      forwardLinks,
      backlinks: backlinks.map((b) => b.title),
    });

    for (const link of forwardLinks) {
      if (!visited.has(link.toLowerCase()))
        queue.push({ title: link, depth: item.depth + 1 });
    }
    for (const bl of backlinks) {
      if (!visited.has(bl.title.toLowerCase()))
        queue.push({ title: bl.title, depth: item.depth + 1 });
    }
  }

  return visited;
}

// ─── Vault summary (used by world_context) ───────────────────────────────────

export interface VaultSummary {
  totalNotes: number;
  countByType: Record<string, number>;
  recentTitles: Array<{ title: string; type: NoteType; updated: string }>;
}

export async function getVaultSummary(): Promise<VaultSummary | null> {
  const root = getAgentVaultRoot();
  if (!getExplicitAgentVaultPathFromEnv() && !existsSync(root)) {
    return null;
  }
  try {
    const notes = await listAllNotes({ limit: 200 });
    if (notes.length === 0) return null;

    const countByType: Record<string, number> = {};
    for (const n of notes) {
      countByType[n.type] = (countByType[n.type] ?? 0) + 1;
    }

    const recentTitles = notes.slice(0, 5).map((n) => ({
      title: n.title,
      type: n.type,
      updated: n.updated.slice(0, 10),
    }));

    return { totalNotes: notes.length, countByType, recentTitles };
  } catch {
    return null;
  }
}
