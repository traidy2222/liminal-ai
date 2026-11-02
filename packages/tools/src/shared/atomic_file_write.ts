import { chmod, link, rename, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

/** Commit complete bytes on the same filesystem, preserving existing permissions. */
export async function atomicWriteText(target: string, content: string, createOnly = false): Promise<void> {
  const temporary = `${target}.${randomUUID()}.tmp`;
  let mode = 0o666 & ~process.umask();
  if (!createOnly) {
    try { mode = (await stat(target)).mode & 0o777; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
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
