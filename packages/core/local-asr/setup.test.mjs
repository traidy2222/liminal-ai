import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, readdir, stat, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';

const setup = new URL('./setup.mjs', import.meta.url).href;
function installer(root) {
  return spawn(process.execPath, ['--input-type=module', '-e', `import {installTranscription} from ${JSON.stringify(setup)}; await installTranscription({uv:process.execPath});`], {
    cwd: root, env: { ...process.env, LIMINAL_LOCAL_ASR_HOME: path.join(root, 'home') }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
}
async function ready(root) {
  for (let i = 0; i < 200; i++) {
    try { return Number(await readFile(path.join(root, 'venv-pid'), 'utf8')); } catch { await delay(20); }
  }
  throw new Error('Fake uv never started');
}
const exit = child => new Promise(resolve => child.once('exit', code => resolve(code)));
const kill = pid => { try { process.kill(pid, 'SIGKILL'); } catch { /* already exited */ } };

test('installer records its owner, excludes a live installer, and recovers after process death', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'asr-install-lock-'));
  await writeFile(path.join(root, 'venv'), `require('fs').writeFileSync('venv-pid',String(process.pid));setInterval(()=>{},1000);`);
  const first = installer(root), firstExit = exit(first);
  let fakePid, second;
  try {
    fakePid = await ready(root);
    const lock = path.join(root, 'home', 'whisper', 'install.lock');
    const info = await stat(lock);
    const record = info.isDirectory() ? await readFile(path.join(lock, (await readdir(lock))[0]), 'utf8') : await readFile(lock, 'utf8');
    assert.equal(Number(JSON.parse(record || '0').pid ?? record), first.pid, 'installer lock must record its actual owner PID');
    const competing = installer(root); let competingError = '';
    competing.stderr.on('data', data => { competingError += data; });
    assert.notEqual(await exit(competing), 0); assert.match(competingError, /already running/);
    kill(first.pid); await firstExit; kill(fakePid);
    await writeFile(path.join(root, 'venv'), 'process.exit(23);');
    second = installer(root); let error = '';
    second.stderr.on('data', data => { error += data; });
    assert.notEqual(await exit(second), 0);
    assert.doesNotMatch(error, /already running/, 'dead installer must not block a retry');
    assert.match(error, /failed \(23\)/, 'retry must reach the fake uv instead of stopping at the stale lock');
    await assert.rejects(stat(lock), { code: 'ENOENT' });
  } finally {
    kill(first.pid); if (fakePid) kill(fakePid); if (second?.pid) kill(second.pid);
    await firstExit; await rm(root, { recursive: true, force: true });
  }
});
