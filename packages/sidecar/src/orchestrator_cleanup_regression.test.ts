import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatOrchestrator } from './chat_orchestrator.js';
for (const method of ['runWorker', 'runSynthesis']) {
  test(`${method} failure removes auto-approval membership`, async () => {
    const bridge = { chatId: 'fixture', beginSession: async () => { throw new Error('fixture failure'); } };
    const o = new ChatOrchestrator({ registry: { create: async () => bridge, touch: () => {} }, emit: () => {} } as any) as any;
    o.snapshot.workers = [{ taskId: 'task', title: 'test', status: 'pending' }];
    const task = { id: 'task', title: 'test', prompt: 'test' };
    await assert.rejects(method === 'runWorker' ? o.runWorker('goal', task, [task], '') : o.runSynthesis('goal', undefined, new Map()), /fixture failure/);
    assert.equal(o.autopilotChats.size, 0);
  });
}
