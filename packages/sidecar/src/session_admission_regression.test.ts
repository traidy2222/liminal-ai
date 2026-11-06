import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionBridge } from './session_bridge.js';
test('bridge reserves a turn before asynchronous harness setup', async () => {
  const bridge = Object.create(SessionBridge.prototype) as any;
  let finish!: () => void;
  const pending = new Promise<void>(r => { finish = r; });
  let calls = 0;
  const accepted:string[]=[];
  bridge.onUserMessageAccepted=(message:string)=>accepted.push(message);
  bridge.workspaceRoot = process.cwd();
  bridge.harness = { getIsRunning: () => false, send: async () => { calls++; await pending; } };
  bridge.emit = () => {};
  const first = bridge.sendUserMessage('one');
  try {
    const rejected = bridge.sendUserMessage('two').then(() => false, (e: Error) => /busy/i.test(e.message));
    assert.equal(await Promise.race([rejected, new Promise<boolean>(r => setTimeout(() => r(false), 100))]), true, 'second turn must reject before the first finishes');
    assert.equal(calls, 1);
    assert.deepEqual(accepted,['one'],'only an accepted message changes chat recency');
    assert.equal(bridge.isBusy, true);
    assert.ok(bridge.turnStartedAt);
  } finally { finish(); await first; bridge.stopHeartbeat(); }
  assert.equal(bridge.isBusy, false);
});
