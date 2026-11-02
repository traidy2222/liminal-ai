import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AgentEmitter, ToolDispatcher, ToolRegistry, runWithWorkspaceRoot, setFileWriteStreamManifest } from '@liminal/core';
import { writeFileTool } from './write_file.js';

test('real write_file consumes staging only from its owning dispatcher', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'liminal-stream-dispatch-'));
  try {
    await runWithWorkspaceRoot(root, async () => {
      const registry = new ToolRegistry();
      registry.register(writeFileTool);
      const dispatcher = new ToolDispatcher(registry, new AgentEmitter());
      dispatcher.setFileWriteHooks({
        prepareArgs: async (callId, _name, args) => {
          const stagingPath = path.join(root, 'owned.tmp');
          await writeFile(stagingPath, 'complete staged content');
          setFileWriteStreamManifest({ callId, stagingPath, targetPath: path.join(root, 'result.txt'), mode: 'create', bytesWritten: 23 });
          return { ...args, __harness_call_id: callId };
        },
        onRejected() {},
      });
      const result = await dispatcher.dispatch('same-id', 'write_file', JSON.stringify({ path: 'result.txt', content: 'incomplete argument' }));
      assert.equal(result.ok, true, result.ok ? undefined : result.error);
      assert.equal(await readFile(path.join(root, 'result.txt'), 'utf8'), 'complete staged content');
      // Reusing that ID through another dispatcher cannot consume the old staging.
      const other = new ToolDispatcher(registry, new AgentEmitter());
      const second = await other.dispatch('same-id', 'write_file', JSON.stringify({ path: 'other.txt', content: 'other content', __harness_call_id: 'same-id' }));
      assert.equal(second.ok, true, second.ok ? undefined : second.error);
      assert.equal(await readFile(path.join(root, 'other.txt'), 'utf8'), 'other content');
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});
