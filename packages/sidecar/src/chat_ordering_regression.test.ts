import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createChatMetadata,readChatMetadata,updateChatMetadata,listChats} from '@liminal/core';
import {ChatRegistry} from './chat_registry.js';

test('opening and activating preserve chat order; accepted activity moves it and survives reload',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'liminal-chat-order-'));
 const previous=process.env.AGENT_GLOBAL_STORAGE_ROOT;process.env.AGENT_GLOBAL_STORAGE_ROOT=root;
 const registry=new ChatRegistry({provider:{apiKey:'offline',model:'offline',baseURL:'https://example.invalid'},runtimePreferences:null,repoRoot:root,sink:()=>{}});
 try{
  for(const [chatId,updatedAt] of [['older',100],['newer',200]] as const){
   await createChatMetadata({chatId,title:chatId,workspaceMode:'folder',workspaceRoot:root});
   await updateChatMetadata(chatId,meta=>({...meta,updatedAt}));
  }
  const internal=registry as any;internal.booted=true;internal.diskMetas=await listChats();
  for(const meta of internal.diskMetas)internal.slots.set(meta.chatId,{bridge:{isBusy:false,replayPersistedTranscript:async()=>{},dispose:()=>{}},title:meta.title,workspaceRoot:root,updatedAt:meta.updatedAt});
  internal.openBridgeFromMeta=async(meta:any)=>internal.slots.get(meta.chatId).bridge;
  assert.deepEqual(registry.list().map(r=>r.chatId),['newer','older']);
  assert.ok(await registry.open('older'));assert.ok(await registry.activate('older'));
  assert.deepEqual(registry.list().map(r=>r.chatId),['newer','older']);
  assert.equal((await readChatMetadata('older'))!.updatedAt,100);
  registry.touch('older');
  await updateChatMetadata('older',meta=>meta); // Drain the queued activity write.
  assert.deepEqual(registry.list().map(r=>r.chatId),['older','newer']);
  assert.deepEqual((await listChats()).map(r=>r.chatId),['older','newer']);
 }finally{registry.disposeAll();if(previous===undefined)delete process.env.AGENT_GLOBAL_STORAGE_ROOT;else process.env.AGENT_GLOBAL_STORAGE_ROOT=previous;await rm(root,{recursive:true,force:true});}
});
