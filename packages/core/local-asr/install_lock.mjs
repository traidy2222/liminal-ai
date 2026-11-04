import { randomUUID } from 'node:crypto';
import { unlinkSync, rmdirSync } from 'node:fs';
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return true; // Unknown owners are not safe to steal.
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}

/** Unique owner files make stale cleanup safe: a new installer never reuses an old owner's path. */
export async function acquireInstallLock(home) {
  const directory = path.join(home, 'install.lock');
  const owner = path.join(directory, `${process.pid}-${randomUUID()}.json`);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    process.off('exit', release);
    try { unlinkSync(owner); } catch { /* absent after failure/crash cleanup */ }
    // rmdir is atomic and never removes another installer's nonempty directory.
    try { rmdirSync(directory); } catch { /* another owner, or already removed */ }
  };
  for (let attempt = 0; ; attempt++) {
    try {
      await mkdir(directory, { recursive: true });
      await writeFile(owner, JSON.stringify({ pid: process.pid }), { flag: 'wx' });
      break;
    } catch (error) {
      if (error.code === 'ENOENT' && attempt < 3) continue; // Empty directory removed by a finishing installer.
      if (error.code === 'EEXIST') {
        // Migrate a legacy PID-file lock. unlink cannot remove a directory that
        // another new installer acquired while this process inspected the file.
        let raw;
        try { raw = await readFile(directory, 'utf8'); } catch (readError) {
          if (['EISDIR', 'EPERM', 'ENOENT'].includes(readError.code) && attempt < 3) continue;
          throw readError;
        }
        const pid = Number(raw.trim());
        if (pid > 0 && !alive(pid)) {
          try { await unlink(directory); } catch (removeError) {
            if (!['EISDIR', 'EPERM', 'ENOENT'].includes(removeError.code)) throw removeError;
          }
          if (attempt < 3) continue;
        }
        throw new Error(`Transcription installation already running, or an older installer left an unidentifiable lock in ${home}. Stop the older installer before removing its legacy lock.`);
      }
      throw error; // Permissions/disk failures must retain their real error.
    }
  }
  try {
    for (const name of await readdir(directory)) {
      if (name === path.basename(owner)) continue;
      const other = path.join(directory, name);
      // The unique filename records ownership even if a crash interrupted its
      // small JSON write. A truncated record must not permanently block retries.
      if (!/^[1-9]\d*-[a-f0-9-]+\.json$/.test(name) || alive(Number(name.split('-')[0]))) {
        throw new Error(`Transcription installation already running in ${home}.`);
      }
      await unlink(other).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  } catch (error) { release(); throw error; }
  process.once('exit', release);
  return release;
}
