import { rm } from "node:fs/promises";

export type FileWriteStreamManifest = {
  callId: string;
  stagingPath: string;
  targetPath: string;
  mode: "create" | "append" | "overwrite";
  bytesWritten: number;
};

const pending = new Map<string, FileWriteStreamManifest>();

export function setFileWriteStreamManifest(m: FileWriteStreamManifest): void {
  pending.set(m.callId, m);
}

export function takeFileWriteStreamManifest(callId: string): FileWriteStreamManifest | undefined {
  const m = pending.get(callId);
  if (m) pending.delete(callId);
  return m;
}

export function discardFileWriteStreamManifest(callId: string): void {
  pending.delete(callId);
}

/** Remove detached bytes before releasing manifest ownership; retain it on I/O failure. */
export async function cleanupFileWriteStreamManifest(callId: string): Promise<void> {
  const manifest = pending.get(callId);
  if (!manifest) return;
  await rm(manifest.stagingPath, { force: true });
  if (pending.get(callId) === manifest) pending.delete(callId);
}
