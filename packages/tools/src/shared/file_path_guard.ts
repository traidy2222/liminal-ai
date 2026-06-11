import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import { resolveWorkspaceRoot } from "@liminal/core";

export interface GuardResult {
  ok: boolean;
  resolvedPath?: string;
  error?: string;
}

/** True when `resolved` is the workspace root or a path under it. */
export function isPathInsideWorkspaceRoot(resolved: string, workspaceRoot: string): boolean {
  const root = path.resolve(workspaceRoot);
  const abs = path.resolve(resolved);
  const rel = path.relative(root, abs);
  if (!rel.startsWith("..") && !path.isAbsolute(rel)) return true;
  if (process.platform === "win32") {
    const r = abs.toLowerCase();
    const w = root.toLowerCase();
    return r === w || r.startsWith(`${w}${path.sep}`);
  }
  return false;
}

export function resolveWithinWorkspace(inputPath: string): GuardResult {
  const trimmed = inputPath.trim();
  if (!trimmed) {
    return { ok: false, error: "empty path" };
  }
  const workspaceRoot = path.resolve(resolveWorkspaceRoot());
  const resolved = path.resolve(workspaceRoot, trimmed);
  if (!isPathInsideWorkspaceRoot(resolved, workspaceRoot)) {
    return { ok: false, error: `Path escapes workspace root: ${inputPath}` };
  }
  return { ok: true, resolvedPath: resolved };
}

export async function readWorkspaceFileBytes(
  inputPath: string
): Promise<
  | { ok: true; bytes: Buffer; resolvedPath: string }
  | { ok: false; error: string }
> {
  const safe = resolveWithinWorkspace(inputPath);
  if (!safe.ok || !safe.resolvedPath) {
    return { ok: false, error: safe.error ?? "invalid path" };
  }
  try {
    const bytes = await readFile(safe.resolvedPath);
    return { ok: true, bytes, resolvedPath: safe.resolvedPath };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `read_file failed for "${inputPath}": ${msg}` };
  }
}

export async function existsAtPath(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

