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
  return re.test(body);
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

/** Build a "## Related" wikilink section (empty string when no titles). */
export function buildRelatedSection(titles: string[]): string {
  if (titles.length === 0) return "";
  return `## Related\n${titles.map((t) => `- [[${t}]]`).join("\n")}`;
}

/**
 * Inject [[wikilinks]] to `relatedTitles` into `body`, skipping any already
 * present. Appends to an existing "## Related" section if one exists, otherwise
 * adds a new one at the end. Returns the body unchanged when nothing is new.
 */
export function injectRelatedLinks(body: string, relatedTitles: string[]): string {
  const fresh = relatedTitles.filter((t) => t.trim() && !bodyLinksTo(body, t));
  if (fresh.length === 0) return body;

  const bullets = fresh.map((t) => `- [[${t}]]`).join("\n");
  const relatedHeader = /^##\s+Related\s*$/im;
  if (relatedHeader.test(body)) {
    // Append bullets right under the existing "## Related" header.
    return body.replace(relatedHeader, (h) => `${h}\n${bullets}`);
  }
  return `${body.trimEnd()}\n\n## Related\n${bullets}\n`;
}

/** Format a contradiction callout (Obsidian admonition) preserving both sources. */
export function buildContradictionCallout(params: {
  conflictingTitle: string;
  detail: string;
}): string {
  const detail = params.detail.replace(/\n+/g, " ").trim().slice(0, 300);
  return (
    `> [!contradiction] Conflicts with [[${params.conflictingTitle}]]\n` +
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
}

const INDEX_HEADER = "# Index\n\nContent catalog of the vault — one line per note.\n";

function indexLine(e: IndexEntry): string {
  const summary = e.summary.replace(/\n+/g, " ").trim().slice(0, 160);
  return `- [[${e.title}]] (${e.type})${summary ? ` — ${summary}` : ""}`;
}

/**
 * Upsert a single note into the index.md catalog. Replaces the existing line for
 * the same title (case-insensitive) or appends a new one. Lines stay sorted by
 * title for stable diffs.
 */
export function upsertIndexEntry(existing: string, entry: IndexEntry): string {
  const lineRe = new RegExp(`^- \\[\\[\\s*${escapeRegExp(entry.title)}\\s*\\]\\]`, "i");
  const bodyLines = (existing.trim() ? existing : INDEX_HEADER)
    .split("\n")
    .filter((l) => !lineRe.test(l));

  // Separate header/prose from the bullet catalog.
  const bullets = bodyLines.filter((l) => /^- \[\[/.test(l));
  const head = bodyLines.filter((l) => !/^- \[\[/.test(l));

  bullets.push(indexLine(entry));
  bullets.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

  const headText = head.join("\n").trimEnd() || INDEX_HEADER.trimEnd();
  return `${headText}\n\n${bullets.join("\n")}\n`;
}
