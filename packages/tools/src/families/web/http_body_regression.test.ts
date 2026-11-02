import test from 'node:test';
import assert from 'node:assert/strict';
import { httpRequestTool } from './http_request.js';
test('HTTP response reading stops at a bounded size and cancels the stream',async(t)=>{
 let reads=0,cancelled=false;
 t.mock.method(globalThis,'fetch',async()=>new Response(new ReadableStream({pull(c){reads++;c.enqueue(new TextEncoder().encode('x'.repeat(1000)));if(reads===100)c.close();},cancel(){cancelled=true;}})));
 const result=await httpRequestTool.handler({url:'https://example.invalid',max_response_chars:200});
 assert.equal(result.ok,true);assert.ok(reads<10,`read ${reads} chunks`);assert.equal(cancelled,true);
 assert.match(JSON.parse(result.output!).body,/truncated/);
});
test('invalid JSON content type preserves the body as text',async(t)=>{
 t.mock.method(globalThis,'fetch',async()=>new Response('{incomplete',{headers:{'content-type':'application/json'}}));
 const result=await httpRequestTool.handler({url:'https://example.invalid'});
 assert.equal(JSON.parse(result.output!).body,'{incomplete');
});
