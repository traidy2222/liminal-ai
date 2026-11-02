import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm,readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AgentHarness } from './agent.js';
import { FileWriteStreamSink } from './file_write_stream_sink.js';
import { runWithWorkspaceRoot } from './workspace_root.js';
test('interrupted file writes delete unusable staging after building the retry hint',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'liminal-staging-cleanup-'));
 try {await runWithWorkspaceRoot(root,async()=>{
  const agent:any=Object.create(AgentHarness.prototype);
  Object.assign(agent,{context:{append(){},appendMessage(){}},emitter:{emit(){}},toolsUsedThisTurn:[],toolCallsWithArgsThisTurn:[],noteVerificationToolOutcome(){},rememberChangedPathFromToolCall(){}});
  for(const failed of [false,true]){
   const sink=new FileWriteStreamSink(true,1);agent.fileWriteStreamSink=sink;
   const partial='{"path":"target.txt","content":"incomplete bytes';
   await sink.ingestDelta('partial','write_file',partial);await sink.finalize('partial');
   assert.equal((await readdir(path.join(root,'.agent_write_staging','inflight'))).length,1);
   if(failed)(sink as any).entries.get('partial').writeFailed=true;
   await agent.commitInterruptedStreamAttempt('',[{id:'partial',name:'write_file',argsJson:partial}],'fixture',new Map());
   assert.deepEqual(await readdir(path.join(root,'.agent_write_staging','inflight')),[]);
  }
 });}finally{await rm(root,{recursive:true,force:true});}
});
