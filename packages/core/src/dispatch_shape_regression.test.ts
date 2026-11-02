import test from 'node:test';
import assert from 'node:assert/strict';
import { ToolDispatcher } from './dispatcher.js';
import { ToolRegistry } from './registry.js';
import { AgentEmitter } from './events.js';
test('dispatcher returns validation failures for JSON scalars, arrays and null',async()=>{
 const registry=new ToolRegistry();let calls=0;
 registry.register({name:'fixture',description:'test',parameters:{type:'object',properties:{},additionalProperties:false},requiresApproval:false,dangerLevel:'safe',handler:async()=>{calls++;return {ok:true,output:'ran'};}});
 const dispatcher=new ToolDispatcher(registry,new AgentEmitter());
 for(const json of ['null','[]','42','true','"text"'])assert.equal((await dispatcher.dispatch('fixture', 'fixture',json)).ok,false,json);
 assert.equal(calls,0);
});
