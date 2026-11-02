import test from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns';
import {syncBuiltinESMExports} from 'node:module';
import {createServer} from 'node:http';
import {runWebFetch} from './web_fetch.js';

test('web_fetch rejects public-looking DNS names resolving to loopback before connecting',async(t)=>{
 const env={...process.env};process.env.AGENT_WEB_FETCH_SERPER='0';process.env.AGENT_WEB_READABILITY='0';process.env.AGENT_WEB_FETCH_RETRIES='0';
 let connections=0;const server=createServer((_req,res)=>{connections++;res.setHeader('content-type','text/plain');res.end('private service data');});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 try {
  t.mock.method(dns,'lookup',(_hostname:any,options:any,callback:any)=>{callback(null,options?.all?[{address:'127.0.0.1',family:4}]:'127.0.0.1',4);});syncBuiltinESMExports();
  const result=await runWebFetch(`http://public.fixture:${(server.address() as any).port}/`,4000);
  assert.equal(result.ok,false);assert.equal(connections,0,'no socket may reach a private destination');
 }finally{t.mock.restoreAll();syncBuiltinESMExports();process.env=env;server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
test('web_fetch validates redirect targets before following them',async(t)=>{
 const env={...process.env};process.env.AGENT_WEB_FETCH_SERPER='0';process.env.AGENT_WEB_READABILITY='0';process.env.AGENT_WEB_FETCH_RETRIES='0';
 let privateReached=false;
 t.mock.method(globalThis,'fetch',async(_url:any,init:any)=>{
   if(init.redirect==='manual')return new Response(null,{status:302,headers:{location:'http://[::1]/private'}});
   privateReached=true;return new Response('private service data',{headers:{'content-type':'text/plain'}});
 });
 try {const result=await runWebFetch('https://public.fixture/',4000);assert.equal(result.ok,false);assert.equal(privateReached,false);}
 finally{process.env=env;}
});
