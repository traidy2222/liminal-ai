import test from 'node:test';import assert from 'node:assert/strict';
import {AgentEmitter,type AgentHarness,type ContextSnapshot} from '@liminal/core';import {SessionBridge} from './session_bridge.js';
const snapshot:ContextSnapshot={tokenCount:1,maxTokens:100,usageFraction:.01,masked:false};
test('closed desktop turns reject late reply/tool output; retrying an accepted request cannot repeat it',async()=>{
 const emitter=new AgentEmitter(),frames:any[]=[];let sends=0;
 const harness={emitter,getIsRunning:()=>false,getToolExecutionScope:()=>'terminal-fixture',closeProcedureRuntime:()=>{},send:async()=>{sends++;emitter.emit('send_start',{userMessage:'Save',agentDepth:0});emitter.emit('text',{channel:'user',delta:'Done.'});emitter.emit('turn_end',{contextSnapshot:snapshot});}} as unknown as AgentHarness;
 const bridge=new SessionBridge(harness,'terminal-fixture',process.cwd(),f=>frames.push(f));
 try{
  await bridge.sendUserMessage('Save',{requestId:'first'});const ended=frames.length;
  emitter.emit('text',{channel:'user',delta:'Old reply repeated'});emitter.emit('tool_start',{callId:'late',name:'remember',args:{}});
  emitter.emit('tool_result',{callId:'late',name:'remember',args:{},result:{ok:true,output:'background'}});
  assert.equal(frames.length,ended);
  await bridge.sendUserMessage('Save',{requestId:'first'});assert.equal(sends,1);
  await bridge.sendUserMessage('Save',{requestId:'second'});assert.equal(sends,2,'an intentional new message with identical text must still run');
 }finally{bridge.dispose();}
});
