import test from 'node:test';
import assert from 'node:assert/strict';
import { httpRequestTool } from './http_request.js';
test('Host header lookup is case insensitive',async(t)=>{
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response('ok');});
 for(const key of ['host','hOsT','Host']){
  const result=await httpRequestTool.handler({url:'http://127.0.0.1/',headers:{[key]:'example.invalid'}});
  assert.equal(JSON.parse(result.output!).skipped,undefined);
 }
 assert.equal(calls,3);
});
