import test from 'node:test';
import assert from 'node:assert/strict';
import { WsServer } from './ws_server.js';
test('server teardown closes background services and remote UI server',()=>{
 const server=Object.create(WsServer.prototype) as any;
 const closed=new Set<string>();server.clients=new Set();
 for(const [name,method] of [['appManager','stopRefreshLoop'],['registry','disposeAll'],['ptyManager','disposeAll'],['remoteHost','dispose'],['ptyWss','close'],['browserWss','close'],['wss','close'],['http','close'],['inboxWatcher','stop'],['orchestrator','stop'],['cloudRelay','clear'],['remoteUiWss','close']])server[name! ]={[method!]:()=>closed.add(name!)};
 server.close();
 for(const key of ['inboxWatcher','orchestrator','cloudRelay','remoteUiWss'])assert.ok(closed.has(key),key);
});
