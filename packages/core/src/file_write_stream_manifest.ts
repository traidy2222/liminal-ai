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
