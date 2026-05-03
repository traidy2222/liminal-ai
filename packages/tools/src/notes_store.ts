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

export async function loadNotes(): Promise<Record<string, string>> {
  try {
    const raw = await readFile(NOTES_PATH, "utf8");
    return JSON.parse(raw) as Record<string, string>;
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
 * Atomic read-modify-write for the notes store.
 * All callers wait their turn — the updater receives the current state and
 * returns the new state to persist. On error the queue resets so future
 * writes are not permanently blocked.
 */
export async function atomicUpdate(
  updater: (notes: Record<string, string>) => Record<string, string>
): Promise<void> {
  const thisOp = writeQueue.then(async () => {
    const notes = await loadNotes();          // read inside the queue
    const updated = updater(notes);
    await writeFile(NOTES_PATH, JSON.stringify(updated, null, 2), "utf8");
  });
  // Reset queue to resolved on error so one bad write doesn't block all future ones
  writeQueue = thisOp.catch(() => {});
  await thisOp;
}
