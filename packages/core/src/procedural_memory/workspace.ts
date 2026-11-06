import path from "node:path";
import { realpath, lstat, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fingerprint, relativePath, stableJson } from "./model.js";
const exec = promisify(execFile);
export interface ProcedureWorkspace {
  id: string;
  root: string;
  gitDirectory: string | null;
  branch: string | null;
  head: string | null;
}
export async function identifyProcedureWorkspace(
  input: string,
): Promise<ProcedureWorkspace> {
  const root = await realpath(path.resolve(input)),
    metadata = await lstat(root);
  if (!metadata.isDirectory())
    throw new Error("Procedure workspace must be a directory");
  let gitDirectory: string | null = null,
    branch: string | null = null,
    head: string | null = null;
  const git = async (args: string[]) =>
    String(
      (
        await exec("git", ["-C", root, ...args], {
          timeout: 3000,
          maxBuffer: 16000,
          windowsHide: true,
        })
      ).stdout,
    ).trim();
  try {
    gitDirectory = await realpath(
      await git(["rev-parse", "--absolute-git-dir"]),
    );
    head = await git(["rev-parse", "--verify", "HEAD"]).catch(() => null);
    branch = await git(["symbolic-ref", "--quiet", "--short", "HEAD"]).catch(
      () => null,
    );
  } catch {
    /* Repositories without Git/remotes are supported. */
  }
  // HEAD deliberately is NOT an identity/invalidation key. Real path, concrete
  // worktree Git directory and filesystem identity distinguish linked worktrees.
  const id = fingerprint(
    stableJson({
      root: process.platform === "win32" ? root.toLowerCase() : root,
      gitDirectory:
        gitDirectory && process.platform === "win32"
          ? gitDirectory.toLowerCase()
          : gitDirectory,
      branch,
      dev: metadata.dev,
      ino: metadata.ino,
    }),
  );
  return { id, root, gitDirectory, branch, head };
}
export function inside(root: string, candidate: string) {
  const rel = path.relative(root, candidate);
  return (
    rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel)
  );
}
/** Existing targets and their parent chains must stay inside the canonical
 * workspace. Nonexistent leaf files are allowed, escaping links are not. */
export async function procedurePath(
  root: string,
  relative: string,
): Promise<string> {
  const target = path.resolve(root, relativePath(relative));
  if (!inside(root, target))
    throw new Error("Procedure path escapes workspace");
  let current = target;
  for (;;) {
    try {
      const canonical = await realpath(current);
      if (!inside(root, canonical))
        throw new Error("Procedure path escapes through a link");
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
  return target;
}
export async function boundedFile(
  root: string,
  relative: string,
  max = 1024 * 1024,
): Promise<Buffer> {
  const target = await procedurePath(root, relative),
    metadata = await lstat(target);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > max)
    throw new Error(
      "Procedure evidence needs a bounded ordinary workspace file",
    );
  const bytes = await readFile(target);
  if (bytes.length > max)
    throw new Error("Procedure evidence exceeds size limit");
  return bytes;
}
