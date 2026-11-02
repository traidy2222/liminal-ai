import test from 'node:test';
import assert from 'node:assert/strict';
import { WsServer } from './ws_server.js';
test('upgrade callback handles rejected initialization and closes the affected socket',async()=>{
 const server=Object.create(WsServer.prototype) as any;
 const sent:any[]=[];let closed=false;
 const ws={readyState:1,send:(s:string)=>sent.push(JSON.parse(s)),close:()=>{closed=true;}};
 const promise=Promise.reject(new Error('fixture initialization error'));
 // Observe the rejection separately so the baseline test itself does not leak one.
 let observed=false;
 const originalCatch=promise.catch.bind(promise);
 promise.catch=((fn:any)=>{observed=true;return originalCatch(fn);}) as any;
 originalCatch(()=>{});
 server.token='synthetic';server.onConnection=()=>promise;
 server.wss={handleUpgrade:(_req:any,_socket:any,_head:any,cb:any)=>cb(ws)};
 server.handleProtocolUpgrade({url:'/?token=synthetic',headers:{}},{},Buffer.alloc(0));
 await new Promise(r=>setImmediate(r));
 assert.equal(observed,true);assert.equal(closed,true);assert.equal(sent[0]?.event,'error');
});
