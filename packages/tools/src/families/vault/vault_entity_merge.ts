/**
 * Pure entity-note model + merge logic for the vault nexus.
 *
 * A real knowledge graph stores one note PER ENTITY (person, org, place, event,
 * concept), each a small structured dossier that ACCRETES over time rather than
 * being overwritten:
 *
 *   ## Identity       — who/what it is
 *   ## Current        — what it's doing now (dated, newest first)
 *   ## History        — what it has done (older "current" lines roll down here)
 *   ## Relationships  — [[links]] to connected entities
 *
 * mergeEntity() is the heart of it: given the existing note (or null) and a
 * freshly extracted entity, it folds new facts in without losing history.
 * Deterministic + dependency-free so it is fully unit tested.
 */

export type EntityKind = "person" | "org" | "place" | "event" | "concept";

export interface ExtractedEntity {
  name: string;
  kind: EntityKind;
  summary: string;
  current?: string;
  history?: string;
  relationships?: string[];
}

export interface EntitySections {
  identity: string;
  current: string[];
  history: string[];
  relationships: string[]; // plain names (no [[ ]])
}

const SECTION_RE = /^##\s+(Identity|Current|History|Relationships)\s*$/i;

function stripBullet(line: string): string {
  return line.replace(/^\s*[-*]\s+/, "").trim();
}

function stripWikiBrackets(s: string): string {
  return s.replace(/^\[\[\s*/, "").replace(/\s*(\|[^\]]*)?\]\]\s*$/, "").trim();
}

/** Parse an entity note body into structured sections (lenient). */
export function parseEntityNote(body: string): EntitySections {
  const sections: EntitySections = { identity: "", current: [], history: [], relationships: [] };
  if (!body.trim()) return sections;

  let curKey: keyof EntitySections | null = null;
  const identityLines: string[] = [];
  for (const rawLine of body.split(/\r?\n/)) {
    const m = rawLine.match(SECTION_RE);
    if (m) {
      curKey = m[1]!.toLowerCase() as keyof EntitySections;
      continue;
    }
    if (curKey === "identity") {
      if (rawLine.trim()) identityLines.push(rawLine.trim());
    } else if (curKey === "current" || curKey === "history") {
      const item = stripBullet(rawLine);
      if (item) sections[curKey].push(item);
    } else if (curKey === "relationships") {
      const item = stripWikiBrackets(stripBullet(rawLine));
      if (item) sections.relationships.push(item);
    } else if (rawLine.trim() && !rawLine.startsWith("#")) {
      // Pre-section prose (e.g. a converted plain note) becomes identity.
      identityLines.push(rawLine.trim());
    }
  }
  sections.identity = identityLines.join(" ").trim();
  return sections;
}

/** Render structured sections back to markdown (omits empty optional sections). */
export function renderEntityNote(s: EntitySections): string {
  const parts: string[] = [`## Identity\n${s.identity.trim() || "(unknown)"}`];
  if (s.current.length) parts.push(`## Current\n${s.current.map((c) => `- ${c}`).join("\n")}`);
  if (s.history.length) parts.push(`## History\n${s.history.map((h) => `- ${h}`).join("\n")}`);
  if (s.relationships.length) {
    parts.push(`## Relationships\n${s.relationships.map((r) => `- [[${r}]]`).join("\n")}`);
  }
  return parts.join("\n\n");
}

function dedupeCaseInsensitive(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of items) {
    const k = it.trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(it.trim());
  }
  return out;
}

/** Has this "current" fact already been recorded (ignoring the date prefix)? */
function currentAlreadyPresent(current: string[], factText: string): boolean {
  const norm = factText.trim().toLowerCase();
  return current.some((c) => c.replace(/^\d{4}-\d\d-\d\d:\s*/, "").trim().toLowerCase() === norm);
}

/**
 * Fold an extracted entity into an existing note (or create from scratch).
 * Returns the merged body and whether anything changed.
 */
export function mergeEntity(
  existingBody: string | null,
  e: ExtractedEntity,
  date: string
): { body: string; changed: boolean } {
  const s = existingBody ? parseEntityNote(existingBody) : { identity: "", current: [], history: [], relationships: [] };
  const before = JSON.stringify(s);

  // Identity: fill if missing; never clobber an existing curated identity.
  if (!s.identity && e.summary?.trim()) s.identity = e.summary.trim();

  // Current: newest dated line on top; demote prior current lines to history.
  if (e.current?.trim() && !currentAlreadyPresent(s.current, e.current)) {
    if (s.current.length) s.history = [...s.current, ...s.history];
    s.current = [`${date}: ${e.current.trim()}`];
  }

  // History: append explicit historical facts (deduped).
  if (e.history?.trim()) {
    s.history = dedupeCaseInsensitive([...s.history, e.history.trim()]);
  } else {
    s.history = dedupeCaseInsensitive(s.history);
  }

  // Relationships: union, drop self-reference.
  const selfKey = e.name.trim().toLowerCase();
  s.relationships = dedupeCaseInsensitive([...s.relationships, ...(e.relationships ?? [])]).filter(
    (r) => r.toLowerCase() !== selfKey
  );

  const changed = JSON.stringify(s) !== before;
  return { body: renderEntityNote(s), changed };
}

/** Map an entity kind to a vault NoteType + a kind tag. */
export function entityNoteTypeFor(kind: EntityKind): "entity" | "note" {
  return kind === "event" ? "note" : "entity";
}
