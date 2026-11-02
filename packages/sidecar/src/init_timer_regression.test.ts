import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { WsServer } from './ws_server.js';
test('successful initialization clears its timeout',async(t)=>{
 const server=Object.create(WsServer.prototype) as any;
 server.clients=new Set();server.clientMeta=new Map();server.sendTo=()=>{};
 server.registry={getOrCreateActive:async()=>undefined,list:()=>[],activeId:undefined};
 server.appManager={broadcastAppList:async()=>{}};
 const timers=new Set<ReturnType<typeof setTimeout>>();
 const realSet=setTimeout,realClear=clearTimeout;
 t.mock.method(globalThis,'setTimeout',((fn:any,ms:number,...args:any[])=>{const timer=realSet(fn,ms,...args);if(ms===120000){timer.unref();timers.add(timer);}return timer;}) as any);
 t.mock.method(globalThis,'clearTimeout',((timer:any)=>{timers.delete(timer);realClear(timer);}) as any);
 try{await server.onConnection(new EventEmitter(),{role:'owner'});assert.equal(timers.size,0);}finally{for(const timer of timers)realClear(timer);}
});
