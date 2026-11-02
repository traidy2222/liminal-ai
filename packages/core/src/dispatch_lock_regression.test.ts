import test from 'node:test';
import assert from 'node:assert/strict';
import { ToolDispatcher } from './dispatcher.js';
import { ToolRegistry } from './registry.js';
import { AgentEmitter } from './events.js';
import { TaskOrchestrator } from './orchestrator.js';
import { resolveWorkspaceRoot } from './workspace_root.js';
test('approval waits hold no lock and edited arguments determine the acquired lock',async()=>{
 const registry=new ToolRegistry(), emitter=new AgentEmitter(), orchestrator=new TaskOrchestrator();
 let pendingHolders:string[]=[], executionHolders:string[]=[];
 const key=(p:string)=>`ws:${resolveWorkspaceRoot()}::file:write:${p}`;
 emitter.on('tool_approval',p=>{pendingHolders=orchestrator.locks.getHolders(key('old'));p.resolve({decision:'edit',editedArgs:{path:'new'}});});
 registry.register({name:'fixture',description:'test',parameters:{type:'object',properties:{path:{type:'string'}},required:['path']},requiresApproval:true,dangerLevel:'destructive',resourceLocks:args=>[`file:write:${args.path}`],handler:async()=>{executionHolders=orchestrator.locks.getHolders(key('new'));return {ok:true,output:'ran'};}});
 const d=new ToolDispatcher(registry,emitter,orchestrator,'owner');
 assert.equal((await d.dispatch('call','fixture','{"path":"old"}')).ok,true);
 assert.deepEqual(pendingHolders,[]);assert.deepEqual(executionHolders,['owner']);
 assert.deepEqual(orchestrator.locks.getHolders(key('new')),[]);
});
