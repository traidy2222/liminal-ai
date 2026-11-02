import test from 'node:test';
import assert from 'node:assert/strict';
import {Agent} from 'undici';
import {createServer} from 'node:http';
import {connect} from 'node:net';
import {publicWebFetch} from '../../shared/public_web_fetch.js';
test('public transport receives a real HTTP response through its npm dispatcher',async(t)=>{
 const server=createServer((_req,res)=>res.end('compatible response'));
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 // Route sockets to a local fixture while preserving the actual HTTP parser and dispatcher protocol.
 const fixture=new Agent({connect:(_options,callback)=>{
  const socket=connect({host:'127.0.0.1',port:(server.address() as any).port},()=>callback(null,socket));socket.on('error',error=>callback(error,null));
 }});
 const dispatch=Agent.prototype.dispatch;
 t.mock.method(Agent.prototype,'dispatch',function(options:any,handler:any){return dispatch.call(fixture,options,handler);});
 try{const response=await publicWebFetch('http://public.fixture/');assert.equal(response.status,200);assert.equal(await response.text(),'compatible response');}
 finally{t.mock.restoreAll();await fixture.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});