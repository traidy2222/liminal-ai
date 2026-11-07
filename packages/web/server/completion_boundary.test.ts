import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {AgentBridge} from './agentBridge.js';
test('web retries acknowledge completed requests without generating the old answer again',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'liminal-repeat-'));const previous=process.env.AGENT_GLOBAL_STORAGE_ROOT;process.env.AGENT_GLOBAL_STORAGE_ROOT=root;
 const bridge=Object.create(AgentBridge.prototype) as any;let sends=0;
 bridge.workspaceRoot=root;bridge.chatId='repeat-fixture';bridge.harness={getIsRunning:()=>false,send:async()=>{sends++;}};bridge.sse={send:()=>{}};bridge.startHeartbeat=()=>{};
 try{await bridge.sendUserMessage('Same text',{requestId:'first'});await bridge.sendUserMessage('Same text',{requestId:'first'});assert.equal(sends,1);await bridge.sendUserMessage('Same text',{requestId:'second'});assert.equal(sends,2);}
 finally{if(previous===undefined)delete process.env.AGENT_GLOBAL_STORAGE_ROOT;else process.env.AGENT_GLOBAL_STORAGE_ROOT=previous;await rm(root,{recursive:true,force:true});}
});
