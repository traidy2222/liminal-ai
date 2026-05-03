import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const NOTES_PATH = join(process.cwd(), ".agent_notes.json");

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
    const raw = await readFile(NOTES_PATH, "utf8");
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
    const raw = await readFile(NOTES_PATH, "utf8");
    return JSON.parse(raw) as RawNotesStore;
  } catch {
    return {};
  }
}

export async function saveNotes(notes: Record<string, string>): Promise<void> {
  await writeFile(NOTES_PATH, JSON.stringify(notes, null, 2), "utf8");
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
 * On error the queue resets so one bad write doesn't block all future ones.
 */
export async function atomicUpdate(
  updater: (notes: Record<string, string>) => Record<string, string>
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
        // Value changed — update updatedAt, preserve original createdAt
        rich[k] = { value: v, createdAt: prev.createdAt, updatedAt: now };
      } else {
        // New key or migrating from legacy plain string — create fresh timestamps
        rich[k] = { value: v, createdAt: now, updatedAt: now };
      }
    }
    await writeFile(NOTES_PATH, JSON.stringify(rich, null, 2), "utf8");
  });
  // Reset queue to resolved on error so one bad write doesn't block all future ones
  writeQueue = thisOp.catch(() => {});
  await thisOp;
}
