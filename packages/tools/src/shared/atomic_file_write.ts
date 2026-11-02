import { chmod, link, lstat, rename, realpath, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

/** Commit complete bytes on the same filesystem, preserving existing permissions. */
export async function atomicWriteText(target: string, content: string, createOnly = false): Promise<void> {
  let mode = 0o666 & ~process.umask();
  if (!createOnly) {
    try {
      target = await realpath(target);
      const existing = await stat(target);
      if (existing.nlink > 1) throw new Error("Cannot atomically overwrite a hard-linked file without breaking link identity.");
      mode = existing.mode & 0o777;
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const entry = await lstat(target).catch((failure: NodeJS.ErrnoException) => {
        if (failure.code !== "ENOENT") throw failure;
        return undefined;
      });
      if (entry?.isSymbolicLink()) throw new Error("Cannot atomically overwrite a dangling symlink; resolve its target first.");
    }
  }
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await chmod(temporary, mode);
    if (createOnly) {
      // Unlike rename, link fails atomically if a concurrent writer created target.
      await link(temporary, target);
    } else {
      for (let attempt = 0; ; attempt++) {
        try { await rename(temporary, target); break; }
        catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (process.platform !== "win32" || !["EPERM", "EACCES", "EBUSY"].includes(code ?? "") || attempt >= 6) throw error;
          await new Promise(resolve => setTimeout(resolve, 10 * 2 ** attempt));
        }
      }
    }
  } finally {
    // A cleanup failure must not report an already committed append/create as failed.
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}
