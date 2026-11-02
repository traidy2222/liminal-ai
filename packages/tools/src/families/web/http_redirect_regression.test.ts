import test from 'node:test';
import assert from 'node:assert/strict';
import { httpRequestTool } from './http_request.js';
test('HTTP tool returns redirects without sending approved headers to another origin',async(t)=>{
 let mode: RequestRedirect | undefined;
 t.mock.method(globalThis,'fetch',async(_url:unknown,init:RequestInit)=>{mode=init.redirect;return new Response('',{status:302,headers:{location:'http://internal.invalid'}});});
 const result=await httpRequestTool.handler({url:'https://public.invalid/',headers:{'X-Api-Key':'synthetic'}});
 assert.equal(result.ok,true);assert.equal(mode,'manual');
 assert.equal(JSON.parse(result.output!).status,302);
});
