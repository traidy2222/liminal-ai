import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readdir, readFile, stat, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { acquireInstallLock } from './install_lock.mjs';

test('an interrupted owner-record write is recoverable without deleting a live owner', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'asr-partial-lock-'));
  const dead = spawnSync(process.execPath, ['-e', 'process.exit(0)']).pid;
  const lock = path.join(home, 'install.lock'); await mkdir(lock);
  await writeFile(path.join(lock, `${dead}-abc-def.json`), '{');
  let release;
  try {
    release = await acquireInstallLock(home);
    const entries = await readdir(lock); assert.equal(entries.length, 1); assert.ok(entries[0].startsWith(`${process.pid}-`));
    await assert.rejects(acquireInstallLock(home), /already running/);
    assert.equal((await readdir(lock)).length, 1);
    release(); await assert.rejects(stat(lock), { code: 'ENOENT' });
  } finally { release?.(); await rm(home, { recursive: true, force: true }); }
});

test('handled termination kills owned installation children and releases the lock', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'asr-signal-lock-'));
  await writeFile(path.join(root, 'venv'), `require('fs').writeFileSync('venv-pid',String(process.pid));setInterval(()=>{},1000);`);
  const setup = new URL('./setup.mjs', import.meta.url).href;
  const child = spawn(process.execPath, ['--input-type=module', '-e', `import {installTranscription} from ${JSON.stringify(setup)};process.on('message',()=>process.emit('SIGTERM'));await installTranscription({uv:process.execPath});`], {
    cwd: root, env: { ...process.env, LIMINAL_LOCAL_ASR_HOME: path.join(root, 'home') }, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  const exited = new Promise(resolve => child.once('exit', resolve)); let pid;
  try {
    for (let i = 0; i < 200; i++) {
      try { pid = Number(await readFile(path.join(root, 'venv-pid'), 'utf8')); break; } catch { await delay(20); }
    }
    assert.ok(pid, 'fake uv must start before termination');
    child.send('terminate'); assert.equal(await exited, 143);
    await assert.rejects(stat(path.join(root, 'home', 'whisper', 'install.lock')), { code: 'ENOENT' });
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  } finally {
    try { child.kill('SIGKILL'); } catch {}
    if (pid) try { process.kill(pid, 'SIGKILL'); } catch {}
    await exited; await rm(root, { recursive: true, force: true });
  }
});
