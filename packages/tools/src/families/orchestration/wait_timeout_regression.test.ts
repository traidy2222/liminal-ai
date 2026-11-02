import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskOrchestrator } from '@liminal/core';
import { createOrchestrationTools } from './orchestration.js';
test('waiting timeout does not cancel a still-running child',async()=>{
 const orchestrator=new TaskOrchestrator(),controller=new AbortController();
 orchestrator.register({taskId:'child',parentTaskId:'parent',goal:'work',depth:1,startedAt:Date.now(),status:'running',abortController:controller});
 const harness={orchestrator,getRuntimePreferences:()=>null} as any;
 const tools=createOrchestrationTools(harness);
 const result=await tools.waitForAgentsTool.handler({task_ids:['child'],timeout_ms:1});
 assert.equal(result.ok,false);assert.equal(controller.signal.aborted,false);assert.equal(orchestrator.get('child')?.status,'running');
});
