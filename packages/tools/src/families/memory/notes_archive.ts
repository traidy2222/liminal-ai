/**
 * Soft-delete archive for the note store.
 *
 * `forget` and `curate_memory` route deletions through here first: the full
 * StoredNote is appended to `notes.archive.json` (beside notes.json) before it
 * is removed, so any prune is reversible via `restore_memory`. The archive is a
 * bounded ring buffer (oldest trimmed past AGENT_MEMORY_ARCHIVE_MAX).
 */
import { readFile, writeFile } from "node:fs/promises";
import {
  notesArchivePaths,
  pickReadPath,
  pickWritePath,
  effectiveHarnessEnvRaw,
} from "@liminal/core";
import { loadRawNotes, atomicUpdate, type StoredNote } from "./notes_store.js";

export interface ArchivedNote extends StoredNote {
  /** The store key this note was filed under when archived. */
  originalKey: string;
  /** ISO timestamp of the soft-delete. */
  archivedAt: string;
  /** Why it was archived (e.g. "forget", "curate:stale"). */
  reason: string;
}

/** True (default) when soft-delete archiving is enabled. */
export function isMemoryArchiveEnabled(): boolean {
  return effectiveHarnessEnvRaw("AGENT_MEMORY_ARCHIVE")?.trim() !== "0";
}

function archiveMax(): number {
  const raw = parseInt(effectiveHarnessEnvRaw("AGENT_MEMORY_ARCHIVE_MAX")?.trim() ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 2000;
}

async function loadArchive(): Promise<ArchivedNote[]> {
  try {
    const raw = await readFile(await pickReadPath(notesArchivePaths()), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ArchivedNote[]) : [];
  } catch {
    return [];
  }
}

async function saveArchive(rows: ArchivedNote[]): Promise<void> {
  await writeFile(await pickWritePath(notesArchivePaths()), JSON.stringify(rows, null, 2), "utf8");
}

/**
 * Append soft-deleted notes to the archive (newest last), trimming the oldest
 * rows past the cap. No-op when archiving is disabled. Returns count archived.
 */
export async function archiveNotes(
  entries: Array<{ key: string; note: StoredNote; reason: string }>
): Promise<number> {
  if (!isMemoryArchiveEnabled() || entries.length === 0) return 0;
  const now = new Date().toISOString();
  const rows = await loadArchive();
  for (const e of entries) {
    rows.push({ ...e.note, originalKey: e.key, archivedAt: now, reason: e.reason });
  }
  const max = archiveMax();
  const trimmed = rows.length > max ? rows.slice(rows.length - max) : rows;
  await saveArchive(trimmed);
  return entries.length;
}

/** Return the most recent archived rows (newest first). */
export async function listArchive(limit = 50): Promise<ArchivedNote[]> {
  const rows = await loadArchive();
  return rows.slice(-Math.max(1, limit)).reverse();
}

export interface RestoreResult {
  ok: boolean;
  message: string;
}

/**
 * Restore the most recent archived note for `key` back into the store. Refuses
 * to clobber a key that currently exists. Drops the restored row from the
 * archive on success. Note: timestamps/trust reset (atomicUpdate treats it as a
 * fresh write); the recovered text is preserved.
 */
export async function restoreArchivedNote(key: string): Promise<RestoreResult> {
  const rows = await loadArchive();
  // Most-recent archived entry for this key.
  let idx = -1;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i]!.originalKey === key) {
      idx = i;
      break;
    }
  }
  if (idx === -1) return { ok: false, message: `No archived note found for key "${key}".` };

  const current = await loadRawNotes();
  if (key in current) {
    return { ok: false, message: `Key "${key}" already exists in the store — not overwriting. Forget it first to restore the archived version.` };
  }

  const value = rows[idx]!.value;
  await atomicUpdate((notes) => ({ ...notes, [key]: value }));
  rows.splice(idx, 1);
  await saveArchive(rows);
  return { ok: true, message: `Restored "${key}" from archive.` };
}
