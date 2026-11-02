import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatOrchestrator } from './chat_orchestrator.js';
import { serverFrame } from '@liminal/protocol';
test('yolo false preserves human approval for an autopilot chat', () => {
  let approved = 0;
  const o = new ChatOrchestrator({ registry: { get: () => ({ resolveApproval: () => approved++ }) }, emit: () => {} } as any) as any;
  o.snapshot.yolo = false;
  o.autopilotChats.add('worker');
  o.handleFrame(serverFrame('tool_approval', { callId: 'call', approvalNonce: 'nonce' }, 'worker'));
  assert.equal(approved, 0);
  o.snapshot.yolo = true;
  o.handleFrame(serverFrame('tool_approval', { callId: 'call', approvalNonce: 'nonce' }, 'worker'));
  assert.equal(approved, 1);
});
