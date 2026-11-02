import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionBridge } from './session_bridge.js';
test('session clear preserves bootstrap and refuses active turns', () => {
  const b = Object.create(SessionBridge.prototype) as any;
  let clears = 0, running = false;
  b.harness = { clearConversation: () => clears++, getIsRunning: () => running };
  b.awaitingPersonaBootstrapInput = true;
  b.clearSession();
  assert.equal(b.isAwaitingPersonaBootstrap, true);
  running = true;
  assert.throws(() => b.clearSession(), /busy/i);
  assert.equal(clears, 1);
});
