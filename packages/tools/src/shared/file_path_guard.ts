import path from "node:path";
import { stat } from "node:fs/promises";
import { resolveWorkspaceRoot } from "@liminal/core";

export interface GuardResult {
  ok: boolean;
  resolvedPath?: string;
  error?: string;
}

export function resolveWithinWorkspace(inputPath: string): GuardResult {
  const workspaceRoot = path.resolve(resolveWorkspaceRoot());
  const resolved = path.resolve(workspaceRoot, inputPath);
  const rel = path.relative(workspaceRoot, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return { ok: false, error: `Path escapes workspace root: ${inputPath}` };
  }
  return { ok: true, resolvedPath: resolved };
}

export async function existsAtPath(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

