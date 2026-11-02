import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runWithWorkspaceRoot } from '@liminal/core';
import { resolveWithinWorkspace } from './file_path_guard.js';
test('workspace bound rejects symlink/junction escapes including new descendants', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'liminal-path-'));
  const root = path.join(base, 'workspace'), outside = path.join(base, 'outside');
  const old = process.env.AGENT_WORKSPACE_BOUND;
  try {
    await mkdir(root); await mkdir(outside); await symlink(outside, path.join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    process.env.AGENT_WORKSPACE_BOUND = '1';
    runWithWorkspaceRoot(root, () => {
      assert.equal(resolveWithinWorkspace('escape/new/file.txt').ok, false);
      assert.equal(resolveWithinWorkspace('new/file.txt').ok, true);
    });
  } finally {
    if (old === undefined) delete process.env.AGENT_WORKSPACE_BOUND; else process.env.AGENT_WORKSPACE_BOUND = old;
    await rm(base, { recursive: true, force: true });
  }
});
