import test from 'node:test';
import assert from 'node:assert/strict';
import { WsServer } from './ws_server.js';
for (const pathname of ['/pty', '/browser/stream']) {
  test(`guest upgrade to an unowned ${pathname} session is forbidden`, () => {
    const server = Object.create(WsServer.prototype) as any;
    server.remoteHost = { resolveJoinToken: () => ({ role: 'control', chatId: 'a' }) };
    server.ptyManager = { get: () => ({ chatId: 'b' }) };
    server.registry = { get: () => ({ harness: { taskId: 'task-a' } }) };
    let upgraded = false;
    server.ptyWss = server.browserWss = { handleUpgrade: () => { upgraded = true; } };
    const writes: string[] = [];
    server.handleProtocolUpgrade({ url: `${pathname}?join=synthetic&sessionId=other-session`, headers: {} }, { write: (s: string) => writes.push(s), destroy: () => {} }, Buffer.alloc(0));
    assert.equal(upgraded, false);
    assert.match(writes.join(''), /403 Forbidden/);
  });
}
