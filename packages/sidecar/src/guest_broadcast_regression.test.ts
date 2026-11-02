import test from 'node:test';
import assert from 'node:assert/strict';
import { WsServer } from './ws_server.js';
import { CloudRelayForwarder } from './remote_cloud_connector.js';
import { serverFrame } from '@liminal/protocol';
test('guest broadcast excludes unscoped and other-chat data', () => {
  const server = Object.create(WsServer.prototype) as any;
  const seen: string[] = [];
  const guest = { readyState: 1, send: (s: string) => seen.push(s) };
  server.clients = new Set([guest]);
  server.clientMeta = new Map([[guest, { role: 'view', chatId: 'a' }]]);
  server.cloudRelay = { forward: () => {} };
  for (const chat of [undefined, 'b', 'a']) server.broadcast(serverFrame('error', { message: 'fixture' }, chat));
  assert.equal(seen.length, 1);
  assert.equal(JSON.parse(seen[0]!).chatId, 'a');
});
test('cloud relay forwards only frames within its chat grant', (t) => {
  const seen: unknown[] = [];
  t.mock.method(globalThis, 'fetch', async (...args: unknown[]) => { seen.push(args); return new Response(); });
  const relay = new CloudRelayForwarder();
  relay.setRelay({ relayHostUrl: 'https://example.invalid/relay', joinCode: 'fixture', joinToken: 'synthetic', chatId: 'a' } as any);
  for (const chat of [undefined, 'b', 'a']) relay.forward(JSON.stringify(serverFrame('error', { message: 'fixture' }, chat)));
  assert.equal(seen.length, 1);
});
