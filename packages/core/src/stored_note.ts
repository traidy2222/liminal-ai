/**
 * On-disk note entry shape (shared by local store, cloud sync, and team memory).
 */

export type NoteScope = "chat" | "workspace" | "global";

/** On-disk format for a single note entry. */
export interface StoredNote {
  value: string;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt?: string;
  accessCount?: number;
  confidence?: number;
  links?: string[];
  supersedes?: string;
  deltaOf?: string;
  trigger?: string;
  /** Harness task / sub-agent id (not the human user). */
  actorId?: string;
  workspaceRoot?: string;
  workspaceFingerprint?: string;
  chatId?: string;
  scope?: NoteScope;
  /** Supabase auth user id (team attribution). */
  userId?: string;
  /** Org partition from license `org`. */
  orgId?: string;
  /** Monotonic revision for LWW sync (client-assigned). */
  revision?: number;
  /** Tombstone for remote sync (ISO 8601). */
  deletedAt?: string;
}

export type RawNotesStore = Record<string, StoredNote | string>;

export function getNoteValue(note: StoredNote | string): string {
  return typeof note === "string" ? note : note.value;
}

export function defaultScopeForKey(
  key: string,
  hasWorkspaceFingerprint: boolean
): NoteScope {
  const prefix = key.includes(":") ? key.slice(0, key.indexOf(":")).toLowerCase() : "";
  if (prefix === "user" || prefix === "identity" || prefix === "pref") return "global";
  return hasWorkspaceFingerprint ? "workspace" : "global";
}
