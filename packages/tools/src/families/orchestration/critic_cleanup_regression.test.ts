import test from 'node:test';
import assert from 'node:assert/strict';
import { createOrchestrationTools } from './orchestration.js';
test('critic startup failure cancels children already launched',async(t)=>{
 const old=process.env.AGENT_VERIFY_TOOLS;process.env.AGENT_VERIFY_TOOLS='1';
 t.after(()=>{if(old===undefined)delete process.env.AGENT_VERIFY_TOOLS;else process.env.AGENT_VERIFY_TOOLS=old;});
 let launches=0;const cancelled:string[]=[];
 const harness={orchestrator:{cancel:(id:string)=>cancelled.push(id)},forkChild:()=>{
  if(++launches===2)throw Error('concurrency limit');
  return {taskId:'started-critic',promise:Promise.resolve({taskId:'started-critic',ok:false,output:'cancelled',rounds:0})};
 }} as any;
 const result=await createOrchestrationTools(harness).reflectDebateTool.handler({goal:'inspect',result:'result'});
 assert.equal(result.ok,false);assert.match(String(result.error),/concurrency limit/);assert.deepEqual(cancelled,['started-critic']);
});
