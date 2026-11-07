import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {AgentEmitter} from '@liminal/core';
import {AgentBridge} from './agentBridge.js';
test('web retries acknowledge completed requests without generating the old answer again',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'liminal-repeat-'));const previous=process.env.AGENT_GLOBAL_STORAGE_ROOT;process.env.AGENT_GLOBAL_STORAGE_ROOT=root;
 const bridge=Object.create(AgentBridge.prototype) as any;let sends=0,failBeforeStart=false;const emitter=new AgentEmitter();
 bridge.workspaceRoot=root;bridge.chatId='repeat-fixture';bridge.harness={emitter,getIsRunning:()=>false,send:async()=>{sends++;if(failBeforeStart)throw Error('Fixture admission failed');emitter.emit('send_start',{userMessage:'Same text',agentDepth:0});}};bridge.sse={send:()=>{}};bridge.startHeartbeat=()=>{};
 try{await bridge.sendUserMessage('Same text',{requestId:'first'});await bridge.sendUserMessage('Same text',{requestId:'first'});assert.equal(sends,1);await bridge.sendUserMessage('Same text',{requestId:'second'});assert.equal(sends,2);
  failBeforeStart=true;await assert.rejects(bridge.sendUserMessage('Retry',{requestId:'retry'}),/admission failed/);
  assert.equal(bridge.hasAcceptedRequest('retry'),false);failBeforeStart=false;
  await bridge.sendUserMessage('Retry',{requestId:'retry'});assert.equal(sends,4);assert.equal(bridge.hasAcceptedRequest('retry'),true);
 }
 finally{if(previous===undefined)delete process.env.AGENT_GLOBAL_STORAGE_ROOT;else process.env.AGENT_GLOBAL_STORAGE_ROOT=previous;await rm(root,{recursive:true,force:true});}
});


test('an overlapping HTTP retry shares admission and can retry a pre-start failure', async () => {
 const [{default:express},{createRouter}]=await Promise.all([import('express'),import('./routes.js')]);
 let releaseReady!:()=>void,markReady!:()=>void,markDuplicate!:()=>void;
 const ready=new Promise<void>(resolve=>{releaseReady=resolve;});
 const entered=new Promise<void>(resolve=>{markReady=resolve;});
 const duplicateEntered=new Promise<void>(resolve=>{markDuplicate=resolve;});
 let arrivals=0,sends=0;
 const bridge={
  chatId:'admission-fixture',hasAcceptedRequest:()=>false,isBusy:false,isAwaitingPersonaBootstrap:false,
  harness:{getIsRunning:()=>false},
  whenSessionReady:async()=>{markReady();await ready;},
  sendUserMessage:async(_message:string,opts:{onStart:()=>void})=>{
   sends++;if(sends===1)throw Error('Cannot start fixture turn');opts.onStart();
  },
 };
 const app=express();app.use(express.json());
 app.use((_req,_res,next)=>{if(++arrivals===2)markDuplicate();next();});
 app.use(createRouter({getActive:()=>bridge} as never,{send:()=>{}} as never,{} as never));
 const server=app.listen(0,'127.0.0.1');
 try{
  await new Promise<void>((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
  const address=server.address();assert.ok(address&&typeof address!=='string');
  const submit=()=>fetch('http://127.0.0.1:'+address.port+'/api/message',{
   method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'Save',requestId:'same-request'}),
  });
  const first=submit();await entered;
  const duplicate=submit();await duplicateEntered;releaseReady();
  for(const response of await Promise.all([first,duplicate])){
   assert.equal(response.status,500);assert.deepEqual(await response.json(),{error:'Cannot start fixture turn'});
  }
  assert.equal(sends,1);
  for(let i=0;i<2;i++){
   const response=await submit();assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true});
  }
  assert.equal(sends,2);
 }finally{releaseReady();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
