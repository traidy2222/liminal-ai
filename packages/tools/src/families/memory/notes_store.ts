/**
 * Notes store — delegates to {@link getNotesFacade} in core (local or EE-wrapped).
 */
import {
  getNotesFacade,
  getNoteValue,
  defaultScopeForKey,
  notesPaths,
  pickReadPath,
  pickWritePath,
  type StoredNote,
  type RawNotesStore,
} from "@liminal/core";

export type { StoredNote } from "@liminal/core";
export { getNoteValue, defaultScopeForKey };

export async function notesReadPath(): Promise<string> {
  return pickReadPath(notesPaths());
}

export async function notesWritePath(): Promise<string> {
  return pickWritePath(notesPaths());
}

export function notesPath(): string {
  return notesPaths().legacy;
}

export function makeTypedKey(type: string, key: string): string {
  return `${type}:${key}`;
}

export function getKeyType(key: string): string | null {
  const colon = key.indexOf(":");
  return colon > 0 ? key.slice(0, colon) : null;
}

export async function loadNotes(): Promise<Record<string, string>> {
  return getNotesFacade().loadPlain();
}

export async function loadRawNotes(): Promise<RawNotesStore> {
  return getNotesFacade().readAll();
}

export async function saveNotes(notes: Record<string, string>): Promise<void> {
  await atomicUpdate(() => notes);
}

export async function atomicUpdate(
  updater: (notes: Record<string, string>) => Record<string, string>,
  actorId?: string,
  opts?: { scope?: StoredNote["scope"] }
): Promise<void> {
  await getNotesFacade().atomicUpdate(updater, actorId, opts);
}

export async function bumpNoteMetadata(keys: string[]): Promise<void> {
  await getNotesFacade().bumpNoteMetadata(keys);
}

export async function setNoteScope(
  key: string,
  scope: NonNullable<StoredNote["scope"]>
): Promise<boolean> {
  return getNotesFacade().setNoteScope(key, scope);
}

export async function setNoteConfidence(key: string, confidence: number): Promise<boolean> {
  return getNotesFacade().setNoteConfidence(key, confidence);
}

export async function mergeNoteGraphFields(
  key: string,
  meta: Partial<Pick<StoredNote, "links" | "supersedes" | "deltaOf" | "trigger">>
): Promise<void> {
  await getNotesFacade().mergeNoteGraphFields(key, meta);
}
