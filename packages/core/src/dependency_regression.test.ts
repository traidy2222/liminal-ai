import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskOrchestrator } from './orchestrator.js';
test('missing dependency fails immediately instead of waiting for timeout',async()=>{
 const o=new TaskOrchestrator();o.register({taskId:'task',goal:'test',depth:0,startedAt:Date.now(),status:'running',abortController:new AbortController(),dependsOn:['missing']});
 assert.deepEqual(await o.waitForDependencies('task',20),{ok:false,failedIds:['missing']});
});
