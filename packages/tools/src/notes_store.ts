import { readFile, writeFile } from "node:fs/promises";
import { notesPaths, pickReadPath, pickWritePath, workspaceFingerprint } from "@liminal/core";

/**
 * Read path for the notes file. Prefers `~/.liminal/notes.json` (the new
 * user-global location); falls back to the legacy `.agent_notes.json` under
 * the workspace root when the global file doesn't exist. Async because the
 * fallback requires a stat call.
 */
export async function notesReadPath(): Promise<string> {
  return pickReadPath(notesPaths());
}

/**
 * Write path for the notes file. Always returns the global path when the
 * storage split is active; performs a one-shot lazy migration of the legacy
 * file on the first write so users don't lose their accumulated memory.
 */
export async function notesWritePath(): Promise<string> {
  return pickWritePath(notesPaths());
}

/**
 * @deprecated Use {@link notesReadPath} / {@link notesWritePath}. Kept only for
 * callers that need a synchronous path reference (world_context's path probes,
 * eval scenarios). Returns the legacy workspace-local path verbatim.
 */
export function notesPath(): string {
  return notesPaths().legacy;
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
  // ─── Workspace-aware memory tagging (Phase 1 of per-chat workspaces) ───
  /**
   * Absolute path of the workspace this note was written in. Set automatically
   * by atomicUpdate when missing. Lets recall filter by workspace and lets the
   * ranker apply a current-workspace affinity boost when scoring candidates.
   */
  workspaceRoot?: string;
  /**
   * Stable signature of the workspace: `git:<host>/<owner>/<repo>` when the
   * workspace is a git checkout, else `path:<absolute>`. Two clones of the
   * same repo at different paths share a fingerprint so memory from one
   * surfaces when working in the other.
   */
  workspaceFingerprint?: string;
  /** Chat / harness taskId that owned the note write (provenance). */
  chatId?: string;
  /**
   * Visibility scope across chats (federation Phase 2).
   *   - "chat":      only the writing chatId sees this note (hard filter at the ranker).
   *   - "workspace": every chat sharing the same workspaceFingerprint sees it.
   *   - "global":    every chat on the machine sees it (durable identity facts).
   * Legacy notes without a scope field are treated as "global" so the old
   * "every chat sees everything" behavior is preserved until promotion runs.
   */
  scope?: "chat" | "workspace" | "global";
}

/**
 * Heuristic auto-classifier for the default `scope` of a new note.
 * Identity-shaped keys (user:*, identity:*, pref:*) hop straight to "global"
 * because they're durable facts about the user, not the project. Everything
 * else defaults to "workspace" when a fingerprint resolves so per-project
 * facts stay scoped to that project; without a fingerprint we fall back to
 * "global" (there's no meaningful smaller scope to apply).
 */
export function defaultScopeForKey(
  key: string,
  hasWorkspaceFingerprint: boolean
): NonNullable<StoredNote["scope"]> {
  const prefix = key.includes(":") ? key.slice(0, key.indexOf(":")).toLowerCase() : "";
  if (prefix === "user" || prefix === "identity" || prefix === "pref") return "global";
  return hasWorkspaceFingerprint ? "workspace" : "global";
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
    const raw = await readFile(await notesReadPath(), "utf8");
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
    const raw = await readFile(await notesReadPath(), "utf8");
    return JSON.parse(raw) as RawNotesStore;
  } catch {
    return {};
  }
}

export async function saveNotes(notes: Record<string, string>): Promise<void> {
  await writeFile(await notesWritePath(), JSON.stringify(notes, null, 2), "utf8");
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
  actorId?: string,
  opts?: { scope?: StoredNote["scope"] }
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
    // Per-write workspace tagging: every newly-written note gets the current
    // workspace path + git-aware fingerprint stamped so cross-workspace recall
    // can filter / rank by provenance.
    const wsRoot = (await import("@liminal/core")).resolveWorkspaceRoot();
    const wsFingerprint = workspaceFingerprint(wsRoot);
    // Re-wrap with timestamps
    const rich: RawNotesStore = {};
    for (const [k, v] of Object.entries(updated)) {
      const prev = raw[k];
      // Pick the effective scope for this write. Caller-supplied scope wins;
      // otherwise we re-use whatever the previous version had; otherwise the
      // auto-classifier picks one based on key prefix + fingerprint resolvability.
      const hasFp = wsFingerprint !== "" && !wsFingerprint.startsWith("path:");
      const explicitScope = opts?.scope;
      const inheritScope =
        prev !== undefined && typeof prev === "object" ? (prev as StoredNote).scope : undefined;
      const effectiveScope: NonNullable<StoredNote["scope"]> =
        explicitScope ?? inheritScope ?? defaultScopeForKey(k, hasFp);
      if (prev !== undefined && typeof prev === "object" && prev.value === v) {
        // Unchanged StoredNote — preserve as-is (no timestamp churn) but
        // backfill workspace tags if they're missing (lazy upgrade).
        const p = prev as StoredNote;
        rich[k] = p.workspaceRoot
          ? { ...p, ...(p.scope ? {} : { scope: effectiveScope }) }
          : { ...p, workspaceRoot: wsRoot, workspaceFingerprint: wsFingerprint, scope: effectiveScope };
      } else if (prev !== undefined && typeof prev === "object") {
        // Value changed — update updatedAt, preserve original createdAt + trust + graph fields.
        // Workspace tags refresh to the current writer (most recent owner wins).
        const p = prev as StoredNote;
        rich[k] = {
          ...p,
          value: v,
          createdAt: p.createdAt,
          updatedAt: now,
          accessCount: p.accessCount ?? 0,
          confidence: p.confidence ?? 0.5,
          workspaceRoot: wsRoot,
          workspaceFingerprint: wsFingerprint,
          scope: effectiveScope,
          ...(actorId ? { chatId: actorId } : p.chatId ? { chatId: p.chatId } : {}),
          ...(p.lastAccessedAt ? { lastAccessedAt: p.lastAccessedAt } : {}),
        };
      } else {
        // New key or migrating from legacy plain string — create fresh timestamps
        // and full workspace provenance.
        rich[k] = {
          value: v,
          createdAt: now,
          updatedAt: now,
          accessCount: 0,
          confidence: 0.5,
          workspaceRoot: wsRoot,
          workspaceFingerprint: wsFingerprint,
          scope: effectiveScope,
          ...(actorId ? { actorId, chatId: actorId } : {}),
        };
      }
    }
    await writeFile(await notesWritePath(), JSON.stringify(rich, null, 2), "utf8");
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
    if (changed) await writeFile(await notesWritePath(), JSON.stringify(rich, null, 2), "utf8");
  });
  writeQueue = thisOp.catch(() => {});
  await thisOp;
}

/** Update a single note's scope in place (serialized with writeQueue). */
export async function setNoteScope(
  key: string,
  scope: NonNullable<StoredNote["scope"]>
): Promise<boolean> {
  let changed = false;
  const thisOp = writeQueue.then(async () => {
    const raw = await loadRawNotes();
    const prev = raw[key];
    if (!prev || typeof prev === "string") return;
    const sn = prev as StoredNote;
    if (sn.scope === scope) return;
    raw[key] = { ...sn, scope, updatedAt: new Date().toISOString() };
    await writeFile(await notesWritePath(), JSON.stringify(raw, null, 2), "utf8");
    changed = true;
  });
  writeQueue = thisOp.catch(() => {});
  await thisOp;
  return changed;
}

/** Set a single note's confidence (0–1) in place (serialized with writeQueue). Returns true if changed. */
export async function setNoteConfidence(key: string, confidence: number): Promise<boolean> {
  const clamped = Math.max(0, Math.min(1, confidence));
  let changed = false;
  const thisOp = writeQueue.then(async () => {
    const raw = await loadRawNotes();
    const prev = raw[key];
    if (!prev || typeof prev === "string") return;
    const sn = prev as StoredNote;
    if (sn.confidence === clamped) return;
    raw[key] = { ...sn, confidence: clamped, updatedAt: new Date().toISOString() };
    await writeFile(await notesWritePath(), JSON.stringify(raw, null, 2), "utf8");
    changed = true;
  });
  writeQueue = thisOp.catch(() => {});
  await thisOp;
  return changed;
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
    await writeFile(await notesWritePath(), JSON.stringify(raw, null, 2), "utf8");
  });
  writeQueue = thisOp.catch(() => {});
  await thisOp;
}
