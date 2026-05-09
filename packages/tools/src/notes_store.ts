import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveWorkspaceRoot } from "@liminal/core";

/** Absolute path to `.agent_notes.json` (uses `AGENT_WORKSPACE_ROOT` / monorepo root). */
export function notesPath(): string {
  return join(resolveWorkspaceRoot(), ".agent_notes.json");
}

/** Build a typed key: "{type}:{key}" for structured memory (#3). */
export function makeTypedKey(type: string, key: string): string {
  return `${type}:${key}`;
}

/** Extract the type prefix from a typed key, or null if not typed. */
export function getKeyType(key: string): string | null {
  const colon = key.indexOf(":");
  return colon > 0 ? key.slice(0, colon) : null;
}

// ─── Timestamped note format ──────────────────────────────────────────────────

/** On-disk format for a single note entry (new format with timestamps). */
export interface StoredNote {
  value: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  /** Last time this note was returned by recall / search (trust signal). */
  lastAccessedAt?: string;
  accessCount?: number;
  /** 0–1 trust prior; nudged by consolidation / reuse. */
  confidence?: number;
  /** Graph edges to other note keys (A-MEM / StructMem-style). */
  links?: string[];
  supersedes?: string;
  deltaOf?: string;
  trigger?: string;
  /** Agent task ID that wrote this note (actor-aware memory attribution). */
  actorId?: string;
}

/** On-disk notes file — may contain plain strings (legacy) or StoredNote objects. */
type RawNotesStore = Record<string, StoredNote | string>;

/** Extract the string value from either a legacy plain string or a StoredNote. */
export function getNoteValue(note: StoredNote | string): string {
  return typeof note === "string" ? note : note.value;
}

/**
 * Load all notes as plain string values (timestamps stripped).
 * Handles both legacy plain-string format and new StoredNote format transparently.
 */
export async function loadNotes(): Promise<Record<string, string>> {
  try {
    const raw = await readFile(notesPath(), "utf8");
    const parsed = JSON.parse(raw) as RawNotesStore;
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      result[k] = getNoteValue(v);
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * Load all notes with full timestamp metadata.
 * Used by memory_stats and other tools that need recency information.
 */
export async function loadRawNotes(): Promise<RawNotesStore> {
  try {
    const raw = await readFile(notesPath(), "utf8");
    return JSON.parse(raw) as RawNotesStore;
  } catch {
    return {};
  }
}

export async function saveNotes(notes: Record<string, string>): Promise<void> {
  await writeFile(notesPath(), JSON.stringify(notes, null, 2), "utf8");
}

// ─── Serialized write queue (#4 — H-MEM arXiv:2507.22925) ────────────────────
//
// All writes chain through this module-level promise so concurrent sub-agents
// (which share the same Node.js process) never interleave read-modify-write.
// Module variables are singletons in Node.js — this is intentional.

let writeQueue: Promise<void> = Promise.resolve();

/**
 * Atomic read-modify-write for the notes store, with automatic timestamp management.
 *
 * The updater receives plain string values (same API as before) and returns a new
 * plain-string map. Timestamps are managed automatically:
 *  - New key:       createdAt = updatedAt = now
 *  - Changed value: updatedAt = now, createdAt preserved
 *  - Unchanged key: StoredNote preserved exactly as-is (no timestamp churn)
 *  - Deleted key:   removed from the store
 *
 * Pass `actorId` to attribute the write to a specific agent task ID.
 * On error the queue resets so one bad write doesn't block all future ones.
 */
export async function atomicUpdate(
  updater: (notes: Record<string, string>) => Record<string, string>,
  actorId?: string
): Promise<void> {
  const thisOp = writeQueue.then(async () => {
    const raw = await loadRawNotes();
    // Unwrap all values to plain strings for the updater (same API as before)
    const plain: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      plain[k] = getNoteValue(v);
    }
    const updated = updater(plain);
    const now = new Date().toISOString();
    // Re-wrap with timestamps
    const rich: RawNotesStore = {};
    for (const [k, v] of Object.entries(updated)) {
      const prev = raw[k];
      if (prev !== undefined && typeof prev === "object" && prev.value === v) {
        // Unchanged StoredNote — preserve as-is (no timestamp churn)
        rich[k] = prev;
      } else if (prev !== undefined && typeof prev === "object") {
        // Value changed — update updatedAt, preserve original createdAt + trust + graph fields
        const p = prev as StoredNote;
        rich[k] = {
          ...p,
          value: v,
          createdAt: p.createdAt,
          updatedAt: now,
          accessCount: p.accessCount ?? 0,
          confidence: p.confidence ?? 0.5,
          ...(p.lastAccessedAt ? { lastAccessedAt: p.lastAccessedAt } : {}),
        };
      } else {
        // New key or migrating from legacy plain string — create fresh timestamps
        rich[k] = {
          value: v,
          createdAt: now,
          updatedAt: now,
          accessCount: 0,
          confidence: 0.5,
          ...(actorId ? { actorId } : {}),
        };
      }
    }
    await writeFile(notesPath(), JSON.stringify(rich, null, 2), "utf8");
  });
  // Reset queue to resolved on error so one bad write doesn't block all future ones
  writeQueue = thisOp.catch(() => {});
  await thisOp;
}

/** Increment access counters for retrieved keys (serialized with other note writes). */
export async function bumpNoteMetadata(keys: string[]): Promise<void> {
  const uniq = [...new Set(keys)].filter(Boolean);
  if (uniq.length === 0) return;

  const thisOp = writeQueue.then(async () => {
    const raw = await loadRawNotes();
    const now = new Date().toISOString();
    const rich: RawNotesStore = { ...raw };
    let changed = false;
    for (const k of uniq) {
      const prev = raw[k];
      if (!prev || typeof prev === "string") continue;
      const sn = prev as StoredNote;
      rich[k] = {
        ...sn,
        value: sn.value,
        createdAt: sn.createdAt,
        updatedAt: sn.updatedAt,
        accessCount: (sn.accessCount ?? 0) + 1,
        lastAccessedAt: now,
        confidence: sn.confidence ?? 0.5,
      };
      changed = true;
    }
    if (changed) await writeFile(notesPath(), JSON.stringify(rich, null, 2), "utf8");
  });
  writeQueue = thisOp.catch(() => {});
  await thisOp;
}

/** Merge graph metadata onto an existing rich note (serialized with writeQueue). */
export async function mergeNoteGraphFields(
  key: string,
  meta: Partial<Pick<StoredNote, "links" | "supersedes" | "deltaOf" | "trigger">>
): Promise<void> {
  const thisOp = writeQueue.then(async () => {
    const raw = await loadRawNotes();
    const prev = raw[key];
    if (!prev || typeof prev === "string") return;
    const sn = prev as StoredNote;
    raw[key] = { ...sn, ...meta, updatedAt: new Date().toISOString() };
    await writeFile(notesPath(), JSON.stringify(raw, null, 2), "utf8");
  });
  writeQueue = thisOp.catch(() => {});
  await thisOp;
}
