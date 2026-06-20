/**
 * Pure helpers for the vault "nexus" — the interconnected LLM-wiki layer.
 *
 * The value of a knowledge vault is proportional to its LINK DENSITY, not its
 * note count (Karpathy LLM-Wiki pattern). These helpers turn a freshly written
 * note into a connected graph node: pick the best existing notes to cross-link,
 * inject real [[wikilinks]], and maintain the navigation spine (index.md / log.md).
 *
 * Everything here is deterministic and dependency-free so it can be unit tested
 * without touching the filesystem, the model, or the embedding index.
 */

import type { WikilinkRef } from "./vault_wikilink.js";
import { formatWikilink, formatWikilinkRef } from "./vault_wikilink.js";

export interface NeighborCandidate {
  title: string;
  slug: string;
  /** Similarity / relevance score (cosine or BM25-normalized), higher = closer. */
  score: number;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when `body` already contains a [[wikilink]] (optionally aliased) to `title`. */
export function bodyLinksTo(body: string, title: string): boolean {
  const re = new RegExp(`\\[\\[\\s*${escapeRegExp(title)}\\s*(\\|[^\\]]*)?\\]\\]`, "i");
  if (re.test(body)) return true;
  const slug = title
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  const slugRe = new RegExp(`\\[\\[\\s*(?:[^\\]|/]+/)?${escapeRegExp(slug)}\\s*(?:\\|[^\\]]*)?\\]\\]`, "i");
  return slugRe.test(body);
}

/**
 * Choose the strongest existing notes to cross-link from a new note. Dedupes by
 * title, drops the note itself, and keeps only candidates above `minScore`.
 */
export function selectCrossLinks(
  selfTitle: string,
  candidates: NeighborCandidate[],
  opts?: { max?: number; minScore?: number }
): string[] {
  const max = Math.max(0, opts?.max ?? 6);
  const minScore = opts?.minScore ?? 0.15;
  const selfKey = selfTitle.trim().toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of [...candidates].sort((a, b) => b.score - a.score)) {
    if (c.score < minScore) continue;
    const key = c.title.trim().toLowerCase();
    if (!key || key === selfKey || seen.has(key)) continue;
    seen.add(key);
    out.push(c.title);
    if (out.length >= max) break;
  }
  return out;
}

/** Build a "## Related" wikilink section (empty string when no links). */
export function buildRelatedSection(links: WikilinkRef[]): string {
  if (links.length === 0) return "";
  return `## Related\n${links.map((l) => `- ${formatWikilinkRef(l)}`).join("\n")}`;
}

/**
 * Inject path-based [[wikilinks]] into `body`. Prefer {@link injectRelatedLinkRefs}.
 */
export function injectRelatedLinks(body: string, relatedTitles: string[]): string {
  const fresh = relatedTitles.filter((t) => t.trim() && !bodyLinksTo(body, t));
  if (fresh.length === 0) return body;
  const refs: WikilinkRef[] = fresh.map((t) => ({ target: t, label: t }));
  return injectRelatedLinkRefs(body, refs);
}

/**
 * Inject Obsidian-correct wikilinks (folder/slug paths with optional aliases).
 */
export function injectRelatedLinkRefs(body: string, links: WikilinkRef[]): string {
  const fresh = links.filter((l) => l.target.trim() && !bodyLinksTo(body, l.label ?? l.target));
  if (fresh.length === 0) return body;

  const bullets = fresh.map((l) => `- ${formatWikilinkRef(l)}`).join("\n");
  const relatedHeader = /^##\s+Related\s*$/im;
  if (relatedHeader.test(body)) {
    return body.replace(relatedHeader, (h) => `${h}\n${bullets}`);
  }
  return `${body.trimEnd()}\n\n## Related\n${bullets}\n`;
}

const SOURCES_HEADER = /^##\s+Sources\s*$/im;

/** Inject raw/source wikilinks under ## Sources (Karpathy provenance layer). */
export function injectSourcesLinks(body: string, sourceLinks: WikilinkRef[]): string {
  const fresh = sourceLinks.filter(
    (l) => l.target.trim() && !bodyLinksTo(body, l.label ?? l.target)
  );
  if (fresh.length === 0) return body;
  const bullets = fresh.map((l) => `- ${formatWikilinkRef(l)}`).join("\n");
  if (SOURCES_HEADER.test(body)) {
    return body.replace(SOURCES_HEADER, (h) => `${h}\n${bullets}`);
  }
  return `${body.trimEnd()}\n\n## Sources\n${bullets}\n`;
}

/** Titles selected for inbound backlinks (cap to avoid spam). */
export function selectInboundWeaveTitles(outboundTitles: string[], maxInbound = 3): string[] {
  return outboundTitles.slice(0, Math.max(0, maxInbound));
}

/** Format an MOC (map of content) hub body listing member pages. */
export function buildMocBody(topic: string, memberLinks: WikilinkRef[]): string {
  const seen = new Set<string>();
  const unique = memberLinks.filter((l) => {
    const k = l.target.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return Boolean(l.target.trim());
  });
  return (
    `## Overview\nMap of content for **${topic.trim()}** — curated index of related wiki pages.\n\n` +
    `## Pages\n${unique.map((l) => `- ${formatWikilinkRef(l)}`).join("\n")}\n`
  );
}

export function mocTitleForTopic(topic: string): string {
  const t = topic.trim().slice(0, 80);
  return t.toLowerCase().startsWith("moc") ? t : `MOC — ${t}`;
}

/** Format a contradiction callout (Obsidian admonition) preserving both sources. */
export function buildContradictionCallout(params: {
  conflictingLink: WikilinkRef;
  detail: string;
}): string {
  const detail = params.detail.replace(/\n+/g, " ").trim().slice(0, 300);
  return (
    `> [!contradiction] Conflicts with ${formatWikilinkRef(params.conflictingLink)}\n` +
    `> ${detail || "This note disagrees with an existing note — verify which is current."}`
  );
}

/** Prepend a callout block to a note body (kept above the content). */
export function prependCallout(body: string, callout: string): string {
  if (!callout.trim()) return body;
  return `${callout.trim()}\n\n${body.trimStart()}`;
}

// ─── Navigation spine: log.md (append-only) and index.md (catalog) ─────────────

export interface LogEntry {
  date: string; // YYYY-MM-DD
  action: string; // ingest | update | link | lint
  title: string;
}

const LOG_HEADER = "# Log\n\nChronological record of vault changes (append-only).\n";

/** Append a parseable log line: `## [2026-06-05] ingest | Title`. */
export function appendLogLine(existing: string, entry: LogEntry): string {
  const line = `## [${entry.date}] ${entry.action} | ${entry.title}`;
  const base = existing.trim() ? `${existing.trimEnd()}\n` : `${LOG_HEADER}\n`;
  return `${base}${line}\n`;
}

export interface IndexEntry {
  title: string;
  type: string;
  summary: string;
  /** Vault-relative path for Obsidian link target (e.g. Entities/iran). */
  linkTarget?: string;
}

const INDEX_HEADER = "# Index\n\nContent catalog of the vault — one line per note.\n";

function indexLine(e: IndexEntry): string {
  const summary = e.summary.replace(/\n+/g, " ").trim().slice(0, 160);
  const link = formatWikilink(e.linkTarget ?? e.title, e.title);
  return `- ${link} (${e.type})${summary ? ` — ${summary}` : ""}`;
}

/**
 * Upsert a single note into the index.md catalog. Replaces the existing line for
 * the same title (case-insensitive) or appends a new one. Lines stay sorted by
 * title for stable diffs.
 */
export function upsertIndexEntry(existing: string, entry: IndexEntry): string {
  const lineRe = new RegExp(`^- \\[\\[\\s*${escapeRegExp(entry.title)}\\s*\\]\\]`, "i");
  const lineRePath = new RegExp(
    `^- \\[\\[\\s*${escapeRegExp(entry.linkTarget ?? "")}`,
    "i"
  );
  const bodyLines = (existing.trim() ? existing : INDEX_HEADER)
    .split("\n")
    .filter((l) => !lineRe.test(l) && !(entry.linkTarget && lineRePath.test(l)));

  // Separate header/prose from the bullet catalog.
  const bullets = bodyLines.filter((l) => /^- \[\[/.test(l));
  const head = bodyLines.filter((l) => !/^- \[\[/.test(l));

  bullets.push(indexLine(entry));
  bullets.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

  const headText = head.join("\n").trimEnd() || INDEX_HEADER.trimEnd();
  return `${headText}\n\n${bullets.join("\n")}\n`;
}
