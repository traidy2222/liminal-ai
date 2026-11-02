import { rm } from "node:fs/promises";
import { AsyncLocalStorage } from "node:async_hooks";

export type FileWriteStreamManifest = {
  callId: string;
  stagingPath: string;
  targetPath: string;
  mode: "create" | "append" | "overwrite";
  bytesWritten: number;
};

const owners = new WeakMap<object, Map<string, FileWriteStreamManifest>>();
const ownerContext = new AsyncLocalStorage<object>();
const standaloneOwner = {};

/** Trusted dispatcher identity, separate from model-supplied call IDs/arguments. */
export function runWithFileWriteStreamOwner<T>(owner: object, fn: () => T): T {
  return ownerContext.run(owner, fn);
}

function pendingFor(owner = ownerContext.getStore() ?? standaloneOwner): Map<string, FileWriteStreamManifest> {
  let pending = owners.get(owner);
  if (!pending) { pending = new Map(); owners.set(owner, pending); }
  return pending;
}

export function setFileWriteStreamManifest(m: FileWriteStreamManifest, owner?: object): void {
  pendingFor(owner).set(m.callId, m);
}

export function takeFileWriteStreamManifest(callId: string, owner?: object): FileWriteStreamManifest | undefined {
  const pending = pendingFor(owner);
  const m = pending.get(callId);
  if (m) pending.delete(callId);
  return m;
}

export function discardFileWriteStreamManifest(callId: string, owner?: object): void {
  pendingFor(owner).delete(callId);
}

/** Remove detached bytes before releasing manifest ownership; retain it on I/O failure. */
export async function cleanupFileWriteStreamManifest(callId: string, owner?: object): Promise<void> {
  const pending = pendingFor(owner);
  const manifest = pending.get(callId);
  if (!manifest) return;
  await rm(manifest.stagingPath, { force: true });
  if (pending.get(callId) === manifest) pending.delete(callId);
}
