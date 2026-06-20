/**
 * Obsidian-correct wikilinks — path-relative targets with optional display aliases.
 *
 * Obsidian resolves [[links]] by file path / basename, not YAML frontmatter `title`.
 * Notes in Entities/foo.md must link as [[Entities/foo]] or [[Entities/foo|Label]].
 */
import { relative } from "node:path";
import { findNote, getVaultDir, titleToSlug, resolveAgentPrefix, type NoteType, type VaultNote } from "./vault_store.js";

/** Type folder names (must match vault_store TYPE_FOLDER). */
export const VAULT_TYPE_FOLDER: Record<NoteType, string> = {
  fact: "Facts",
  entity: "Entities",
  reflection: "Reflections",
  recipe: "Recipes",
  task: "Tasks",
  note: "Notes",
  episode: "Episodes",
  concept: "Concepts",
  source: "Sources",
  synthesis: "Synthesis",
  moc: "MOCs",
};

/** Vault-relative link path without `.md` (e.g. `Entities/iran`). */
export function noteRelLinkPath(note: Pick<VaultNote, "filePath">): string {
  const rel = relative(getVaultDir(), note.filePath).replace(/\\/g, "/");
  return rel.replace(/\.md$/i, "");
}

/** Predict link path before the file exists on disk. */
export function predictedRelLinkPath(type: NoteType, title: string): string {
  const prefix = resolveAgentPrefix().replace(/^\/+|\/+$/g, "");
  const tail = `${VAULT_TYPE_FOLDER[type]}/${titleToSlug(title)}`;
  return prefix ? `${prefix}/${tail}` : tail;
}

/** Format one Obsidian wikilink; uses `|alias` when label ≠ filename slug. */
export function formatWikilink(relPath: string, displayTitle?: string): string {
  const target = relPath.replace(/\\/g, "/").replace(/^\.\//, "");
  const base = target.split("/").pop() ?? target;
  const label = displayTitle?.trim();
  if (!label) return `[[${target}]]`;
  const labelSlug = titleToSlug(label);
  if (
    label !== base &&
    labelSlug !== base &&
    label.toLowerCase() !== base.toLowerCase()
  ) {
    return `[[${target}|${label}]]`;
  }
  return `[[${target}]]`;
}

export interface WikilinkRef {
  target: string;
  label?: string;
}

export function formatWikilinkRef(ref: WikilinkRef): string {
  return formatWikilink(ref.target, ref.label);
}

/** Resolve display titles to vault-relative paths (best-effort for missing notes). */
export async function resolveWikilinkRefs(titles: string[]): Promise<WikilinkRef[]> {
  const out: WikilinkRef[] = [];
  const seen = new Set<string>();
  for (const raw of titles) {
    const t = raw.trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    if (t.includes("/")) {
      out.push({ target: t.replace(/\.md$/i, ""), label: t.split("/").pop() });
      continue;
    }

    const note = await findNote(t);
    if (note) {
      out.push({ target: noteRelLinkPath(note), label: note.title });
      continue;
    }

    out.push({ target: predictedRelLinkPath("entity", t), label: t });
  }
  return out;
}

/** Rewrite [[Title]] tokens in markdown to path-based wikilinks where notes exist. */
export async function relinkMarkdownTitles(markdown: string): Promise<string> {
  const re = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  let out = markdown;
  const replacements = new Map<string, string>();

  for (const m of markdown.matchAll(re)) {
    const full = m[0]!;
    const inner = m[1]!.trim();
    if (replacements.has(full)) continue;
    if (inner.includes("/")) continue;

    const note = await findNote(inner);
    if (!note) continue;

    const formatted = formatWikilink(noteRelLinkPath(note), note.title);
    if (formatted !== full) replacements.set(full, formatted);
  }

  for (const [from, to] of replacements) {
    out = out.split(from).join(to);
  }
  return out;
}

/** Normalize a wikilink inner token to a comparable lookup key (path or title). */
export function wikilinkLookupKey(inner: string): string {
  const raw = inner.trim().replace(/\.md$/i, "");
  const base = raw.split("/").pop() ?? raw;
  return base.toLowerCase();
}

/** Whether `body` already links to the note (path, slug, or title). */
export function bodyLinksToNote(body: string, note: Pick<VaultNote, "title" | "slug" | "filePath">): boolean {
  const path = noteRelLinkPath(note as VaultNote);
  const pathRe = new RegExp(`\\[\\[\\s*${escapeRegExp(path)}(?:\\|[^\\]]*)?\\]\\]`, "i");
  if (pathRe.test(body)) return true;

  const titleRe = new RegExp(
    `\\[\\[\\s*${escapeRegExp(note.title)}\\s*(?:\\|[^\\]]*)?\\]\\]`,
    "i"
  );
  if (titleRe.test(body)) return true;

  const slugRe = new RegExp(
    `\\[\\[\\s*(?:[^\\]|/]+/)?${escapeRegExp(note.slug)}\\s*(?:\\|[^\\]]*)?\\]\\]`,
    "i"
  );
  return slugRe.test(body);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
