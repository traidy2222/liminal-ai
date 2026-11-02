import test from 'node:test';
import assert from 'node:assert/strict';
import { ToolDispatcher } from './dispatcher.js';
import { ToolRegistry } from './registry.js';
import { AgentEmitter } from './events.js';
import { TaskOrchestrator } from './orchestrator.js';
import { resolveWorkspaceRoot } from './workspace_root.js';
test('failed multi-lock acquisition leaves a sibling call lock intact',async(t)=>{
 const registry=new ToolRegistry(),orchestrator=new TaskOrchestrator(),locks=orchestrator.locks;
 const key=(p:string)=>`ws:${resolveWorkspaceRoot()}::${p}`;
 await locks.acquireAll([key('X')],'owner');await locks.acquireAll([key('Y')],'other');
 // Use the real acquireAll rollback with only its contended wait shortened.
 const acquire=(locks as any).tryAcquire.bind(locks);
 t.mock.method(locks as any,'tryAcquire',async(id:string,owner:string,ttl:number)=>id===key('Y')?false:acquire(id,owner,ttl));
 registry.register({name:'fixture',description:'fixture',parameters:{type:'object',properties:{}},requiresApproval:false,resourceLocks:()=>['X','Y'],handler:async()=>{throw Error('must not run');}});
 const dispatcher=new ToolDispatcher(registry,new AgentEmitter(),orchestrator,'owner');
 assert.equal((await dispatcher.dispatch('call','fixture','{}')).ok,false);
 assert.deepEqual(locks.getHolders(key('X')),['owner']);assert.deepEqual(locks.getHolders(key('Y')),['other']);
});
