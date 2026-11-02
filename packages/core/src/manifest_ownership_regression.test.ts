import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ToolDispatcher } from './dispatcher.js';
import { ToolRegistry } from './registry.js';
import { AgentEmitter } from './events.js';
import { setFileWriteStreamManifest, takeFileWriteStreamManifest } from './file_write_stream_manifest.js';
import { FileWriteStreamSink } from './file_write_stream_sink.js';
import { runWithWorkspaceRoot } from './workspace_root.js';

test('one dispatcher cannot clean another dispatcher manifest with the same provider ID', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'liminal-manifest-owner-'));
  const stagedA = path.join(root, 'a.tmp');
  const stagedB = path.join(root, 'b.tmp');
  let preparedB!: () => void;
  const bPrepared = new Promise<void>(resolve => { preparedB = resolve; });
  let releaseB!: () => void;
  const aCleaned = new Promise<void>(resolve => { releaseB = resolve; });
  const registry = new ToolRegistry();
  registry.register({
    name: 'write_file', description: 'fixture', dangerLevel: 'safe', requiresApproval: false,
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    handler: async () => {
      preparedB();
      await aCleaned;
      const manifest = takeFileWriteStreamManifest('same-provider-id');
      assert.ok(manifest, 'B must retain its own manifest after A cleanup');
      assert.equal(manifest.stagingPath, stagedB);
      assert.equal(await readFile(manifest.stagingPath, 'utf8'), 'B bytes');
      return { ok: true, output: 'B completed' };
    },
  });
  const a = new ToolDispatcher(registry, new AgentEmitter());
  const b = new ToolDispatcher(registry, new AgentEmitter());
  for (const [dispatcher, stagingPath, bytes] of [[a, stagedA, 'A bytes'], [b, stagedB, 'B bytes']] as const) {
    dispatcher.setFileWriteHooks({
      prepareArgs: async (callId, _name, args) => {
        await writeFile(stagingPath, bytes);
        setFileWriteStreamManifest({ callId, stagingPath, targetPath: path.join(root, 'target'), mode: 'create', bytesWritten: bytes.length });
        if (dispatcher === a) { await bPrepared; return {}; }
        return args;
      },
      onRejected() {},
    });
  }
  let workB: Promise<unknown> | undefined;
  try {
    const workA = a.dispatch('same-provider-id', 'write_file', '{"path":"target"}');
    workB = b.dispatch('same-provider-id', 'write_file', '{"path":"target"}');
    assert.equal((await workA).ok, false);
    releaseB();
    assert.deepEqual(await workB, { ok: true, output: 'B completed' });
    await assert.rejects(access(stagedA), { code: 'ENOENT' });
  } finally {
    releaseB();
    await workB;
    await rm(root, { recursive: true, force: true });
  }
});

test('concurrent sinks in the same workspace keep separate staging bytes for identical IDs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'liminal-sink-owner-'));
  try {
    await runWithWorkspaceRoot(root, async () => {
      const a = new FileWriteStreamSink(true, 1);
      const b = new FileWriteStreamSink(true, 1);
      for (const [sink, content] of [[a, 'A bytes'], [b, 'B bytes']] as const) {
        await sink.ingestDelta('same-provider-id', 'write_file', JSON.stringify({ path: 'target', content }));
        await sink.finalize('same-provider-id');
      }
      const entryA = a.takeForDispatch('same-provider-id')!;
      const entryB = b.takeForDispatch('same-provider-id')!;
      assert.notEqual(entryA.stagingPath, entryB.stagingPath);
      assert.equal(await readFile(entryA.stagingPath, 'utf8'), 'A bytes');
      assert.equal(await readFile(entryB.stagingPath, 'utf8'), 'B bytes');
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});
