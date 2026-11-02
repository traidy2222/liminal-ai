import test from 'node:test';
import assert from 'node:assert/strict';
import { ToolDispatcher } from './dispatcher.js';
import { ToolRegistry } from './registry.js';
import { AgentEmitter } from './events.js';
test('invalid argument shapes still emit object-shaped tool_result args',async()=>{
 const registry=new ToolRegistry(),emitter=new AgentEmitter();const events:any[]=[];emitter.on('tool_result',e=>events.push(e));
 registry.register({name:'fixture',description:'fixture',parameters:{type:'object',properties:{}},requiresApproval:false,handler:async()=>{throw Error('must not run');}});
 const dispatcher=new ToolDispatcher(registry,emitter);
 for(const raw of ['null','[]','42','"text"']){assert.equal((await dispatcher.dispatch(raw,'fixture',raw)).ok,false);assert.deepEqual(events.at(-1).args,{});}
});
