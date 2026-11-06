import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createChatMetadata,readChatMetadata,updateChatMetadata} from '@liminal/core';
import {AgentBridge} from './agentBridge.js';

test('web resume preserves recency and an accepted voice/text message updates it',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'liminal-web-order-'));
 const previous=process.env.AGENT_GLOBAL_STORAGE_ROOT;process.env.AGENT_GLOBAL_STORAGE_ROOT=root;
 try{
  await createChatMetadata({chatId:'history',title:'History',workspaceMode:'folder',workspaceRoot:root});
  await updateChatMetadata('history',meta=>({...meta,updatedAt:100}));
  const bridge=Object.create(AgentBridge.prototype) as any;
  const events:string[]=[];bridge.chatId='history';bridge.workspaceRoot=root;bridge.sse={send:(event:string)=>events.push(event)};
  bridge.harness={getIsRunning:()=>false,send:async()=>{}};bridge.startHeartbeat=()=>{};
  await bridge.resumeSSE();assert.equal((await readChatMetadata('history'))!.updatedAt,100);
  await bridge.sendUserMessage('Spoken message',{liveDictation:true});
  await updateChatMetadata('history',meta=>meta);
  assert.ok((await readChatMetadata('history'))!.updatedAt>100);assert.ok(events.includes('chat_activity'));
  const acceptedAt=(await readChatMetadata('history'))!.updatedAt;
  bridge.harness.getIsRunning=()=>true;await assert.rejects(bridge.sendUserMessage('Rejected'),/busy/);
  assert.equal((await readChatMetadata('history'))!.updatedAt,acceptedAt);
 }finally{if(previous===undefined)delete process.env.AGENT_GLOBAL_STORAGE_ROOT;else process.env.AGENT_GLOBAL_STORAGE_ROOT=previous;await rm(root,{recursive:true,force:true});}
});
