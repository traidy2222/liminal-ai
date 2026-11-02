import test from 'node:test';
import assert from 'node:assert/strict';
import { WsServer } from './ws_server.js';
import { clientFrame } from '@liminal/protocol';
for (const command of ['send_message', 'replay_transcript'] as const) {
  test(`guest ${command} cannot touch a different chat`, async () => {
    const server = Object.create(WsServer.prototype) as any;
    const ws = {};
    let touched = false;
    const acks: any[] = [];
    server.clientMeta = new Map([[ws, { role: 'control', chatId: 'a' }]]);
    server.registry = { get: () => { touched = true; return undefined; }, open: async () => { touched = true; return false; } };
    server.ack = (...args: any[]) => acks.push(args);
    await server.dispatch(ws, clientFrame('test', command, { chatId: 'b', message: 'hello' }));
    assert.equal(touched, false);
    assert.equal(acks[0][2], false);
  });
}
