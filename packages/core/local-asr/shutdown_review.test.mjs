import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { mkdtemp, stat, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { installTranscription } from './setup.mjs';

test('termination retains the profile lock until the installation child closes', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'asr-close-review-'));
  const previous = process.env.LIMINAL_LOCAL_ASR_HOME;
  process.env.LIMINAL_LOCAL_ASR_HOME = root;
  const child = new EventEmitter(); const exits = [];
  let began; const started = new Promise(resolve => { began = resolve; });
  t.mock.method(childProcess, 'spawn', () => { began(); return child; }); syncBuiltinESMExports();
  t.mock.method(process, 'exit', code => { exits.push(code); });
  const installation = installTranscription({ uv: 'fixture-uv' });
  const failed = installation.catch(error => error);
  try {
    await started; process.emit('SIGTERM'); await new Promise(resolve => setImmediate(resolve));
    assert.ok(await stat(path.join(root, 'whisper', 'install.lock')).catch(() => null), 'lock must remain until close');
    assert.deepEqual(exits, []);
    child.emit('close', 23); await failed; await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(exits, [143]);
    await assert.rejects(stat(path.join(root, 'whisper', 'install.lock')), { code: 'ENOENT' });
  } finally {
    child.emit('close', 23); await failed;
    t.mock.restoreAll(); syncBuiltinESMExports();
    if (previous === undefined) delete process.env.LIMINAL_LOCAL_ASR_HOME; else process.env.LIMINAL_LOCAL_ASR_HOME = previous;
    await rm(root, { recursive: true, force: true });
  }
});
