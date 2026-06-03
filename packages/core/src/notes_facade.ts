/**
 * Pluggable notes store — local file by default; EE may wrap with cloud/team sync.
 */
import { readFile, writeFile } from "node:fs/promises";
import { notesPaths, pickReadPath, pickWritePath } from "./global_storage.js";
import { resolveOrgContext, type OrgContext } from "./org_context.js";
import type { RawNotesStore, StoredNote } from "./stored_note.js";
import { getNoteValue } from "./stored_note.js";

export type { StoredNote, RawNotesStore, NoteScope } from "./stored_note.js";
export { getNoteValue, defaultScopeForKey } from "./stored_note.js";

export interface NotesFacade {
  readAll(): Promise<RawNotesStore>;
  loadPlain(): Promise<Record<string, string>>;
  atomicUpdate(
    updater: (notes: Record<string, string>) => Record<string, string>,
    actorId?: string,
    opts?: { scope?: StoredNote["scope"] }
  ): Promise<void>;
  bumpNoteMetadata(keys: string[]): Promise<void>;
  setNoteScope(key: string, scope: NonNullable<StoredNote["scope"]>): Promise<boolean>;
  setNoteConfidence(key: string, confidence: number): Promise<boolean>;
  mergeNoteGraphFields(
    key: string,
    meta: Partial<Pick<StoredNote, "links" | "supersedes" | "deltaOf" | "trigger">>
  ): Promise<void>;
  /** EE / team layer merges remote notes into the read path (optional). */
  mergeRemoteNotes?(remote: RawNotesStore): Promise<void>;
  getOrgContext(): OrgContext;
}

let customFacade: NotesFacade | null = null;
let facadeFactory: ((ctx: OrgContext) => NotesFacade) | null = null;

export function setNotesFacade(facade: NotesFacade | null): void {
  customFacade = facade;
}

export function setNotesFacadeFactory(factory: ((ctx: OrgContext) => NotesFacade) | null): void {
  facadeFactory = factory;
  customFacade = null;
}

export class LocalNotesFacade implements NotesFacade {
  private writeQueue: Promise<void> = Promise.resolve();

  getOrgContext(): OrgContext {
    return resolveOrgContext();
  }

  async readAll(): Promise<RawNotesStore> {
    try {
      const raw = await readFile(await pickReadPath(notesPaths()), "utf8");
      return JSON.parse(raw) as RawNotesStore;
    } catch {
      return {};
    }
  }

  async loadPlain(): Promise<Record<string, string>> {
    const raw = await this.readAll();
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      result[k] = getNoteValue(v);
    }
    return result;
  }

  async atomicUpdate(
    updater: (notes: Record<string, string>) => Record<string, string>,
    actorId?: string,
    opts?: { scope?: StoredNote["scope"] }
  ): Promise<void> {
    const { defaultScopeForKey } = await import("./stored_note.js");
    const { resolveWorkspaceRoot } = await import("./workspace_root.js");
    const { workspaceFingerprint: wsFp } = await import("./global_storage.js");
    const org = resolveOrgContext();

    const thisOp = this.writeQueue.then(async () => {
      const raw = await this.readAll();
      const plain: Record<string, string> = {};
      for (const [k, v] of Object.entries(raw)) {
        plain[k] = getNoteValue(v);
      }
      const updated = updater(plain);
      const now = new Date().toISOString();
      const wsRoot = resolveWorkspaceRoot();
      const fingerprint = wsFp(wsRoot);
      const rich: RawNotesStore = {};

      for (const [k, v] of Object.entries(updated)) {
        const prev = raw[k];
        const hasFp = fingerprint !== "" && !fingerprint.startsWith("path:");
        const explicitScope = opts?.scope;
        const inheritScope =
          prev !== undefined && typeof prev === "object" ? (prev as StoredNote).scope : undefined;
        const effectiveScope =
          explicitScope ?? inheritScope ?? defaultScopeForKey(k, hasFp);

        const nextRevision =
          prev !== undefined && typeof prev === "object"
            ? ((prev as StoredNote).revision ?? 0) + 1
            : 1;

        if (prev !== undefined && typeof prev === "object" && (prev as StoredNote).value === v) {
          const p = prev as StoredNote;
          rich[k] = {
            ...p,
            ...(p.scope ? {} : { scope: effectiveScope }),
            ...(org.orgId && !p.orgId ? { orgId: org.orgId } : {}),
            ...(org.userId && !p.userId ? { userId: org.userId } : {}),
            ...(!p.workspaceRoot
              ? { workspaceRoot: wsRoot, workspaceFingerprint: fingerprint, scope: effectiveScope }
              : {}),
          };
        } else if (prev !== undefined && typeof prev === "object") {
          const p = prev as StoredNote;
          rich[k] = {
            ...p,
            value: v,
            createdAt: p.createdAt,
            updatedAt: now,
            revision: nextRevision,
            accessCount: p.accessCount ?? 0,
            confidence: p.confidence ?? 0.5,
            workspaceRoot: wsRoot,
            workspaceFingerprint: fingerprint,
            scope: effectiveScope,
            ...(org.orgId ? { orgId: org.orgId } : {}),
            ...(org.userId ? { userId: org.userId } : {}),
            ...(actorId ? { chatId: actorId, actorId } : p.chatId ? { chatId: p.chatId } : {}),
            ...(p.lastAccessedAt ? { lastAccessedAt: p.lastAccessedAt } : {}),
          };
        } else {
          rich[k] = {
            value: v,
            createdAt: now,
            updatedAt: now,
            accessCount: 0,
            confidence: 0.5,
            revision: 1,
            workspaceRoot: wsRoot,
            workspaceFingerprint: fingerprint,
            scope: effectiveScope,
            ...(org.orgId ? { orgId: org.orgId } : {}),
            ...(org.userId ? { userId: org.userId } : {}),
            ...(actorId ? { actorId, chatId: actorId } : {}),
          };
        }
      }
      await writeFile(await pickWritePath(notesPaths()), JSON.stringify(rich, null, 2), "utf8");
    });
    this.writeQueue = thisOp.catch(() => {});
    await thisOp;
  }

  async bumpNoteMetadata(keys: string[]): Promise<void> {
    const uniq = [...new Set(keys)].filter(Boolean);
    if (uniq.length === 0) return;

    const thisOp = this.writeQueue.then(async () => {
      const raw = await this.readAll();
      const now = new Date().toISOString();
      const rich: RawNotesStore = { ...raw };
      let changed = false;
      for (const k of uniq) {
        const prev = raw[k];
        if (!prev || typeof prev === "string") continue;
        const sn = prev as StoredNote;
        rich[k] = {
          ...sn,
          accessCount: (sn.accessCount ?? 0) + 1,
          lastAccessedAt: now,
        };
        changed = true;
      }
      if (changed) {
        await writeFile(await pickWritePath(notesPaths()), JSON.stringify(rich, null, 2), "utf8");
      }
    });
    this.writeQueue = thisOp.catch(() => {});
    await thisOp;
  }

  async setNoteScope(key: string, scope: NonNullable<StoredNote["scope"]>): Promise<boolean> {
    let changed = false;
    const thisOp = this.writeQueue.then(async () => {
      const raw = await this.readAll();
      const prev = raw[key];
      if (!prev || typeof prev === "string") return;
      const sn = prev as StoredNote;
      if (sn.scope === scope) return;
      raw[key] = { ...sn, scope, updatedAt: new Date().toISOString() };
      await writeFile(await pickWritePath(notesPaths()), JSON.stringify(raw, null, 2), "utf8");
      changed = true;
    });
    this.writeQueue = thisOp.catch(() => {});
    await thisOp;
    return changed;
  }

  async setNoteConfidence(key: string, confidence: number): Promise<boolean> {
    const clamped = Math.max(0, Math.min(1, confidence));
    let changed = false;
    const thisOp = this.writeQueue.then(async () => {
      const raw = await this.readAll();
      const prev = raw[key];
      if (!prev || typeof prev === "string") return;
      const sn = prev as StoredNote;
      if (sn.confidence === clamped) return;
      raw[key] = { ...sn, confidence: clamped, updatedAt: new Date().toISOString() };
      await writeFile(await pickWritePath(notesPaths()), JSON.stringify(raw, null, 2), "utf8");
      changed = true;
    });
    this.writeQueue = thisOp.catch(() => {});
    await thisOp;
    return changed;
  }

  async mergeNoteGraphFields(
    key: string,
    meta: Partial<Pick<StoredNote, "links" | "supersedes" | "deltaOf" | "trigger">>
  ): Promise<void> {
    const thisOp = this.writeQueue.then(async () => {
      const raw = await this.readAll();
      const prev = raw[key];
      if (!prev || typeof prev === "string") return;
      const sn = prev as StoredNote;
      raw[key] = { ...sn, ...meta, updatedAt: new Date().toISOString() };
      await writeFile(await pickWritePath(notesPaths()), JSON.stringify(raw, null, 2), "utf8");
    });
    this.writeQueue = thisOp.catch(() => {});
    await thisOp;
  }
}

const defaultLocalFacade = new LocalNotesFacade();

export function getNotesFacade(): NotesFacade {
  if (customFacade) return customFacade;
  if (facadeFactory) {
    customFacade = facadeFactory(resolveOrgContext());
    return customFacade;
  }
  return defaultLocalFacade;
}
