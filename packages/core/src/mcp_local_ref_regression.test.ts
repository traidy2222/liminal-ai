import test from 'node:test';
import assert from 'node:assert/strict';
import {ToolDispatcher} from './dispatcher.js';
import {ToolRegistry} from './registry.js';
import {AgentEmitter} from './events.js';
import type {ToolParameterSchema} from './types.js';

test('a referenced native MCP integer is coerced and bounded without changing its remote contract',async()=>{
 const schema={type:'object',properties:{max_records:{$ref:'#/$defs/__schema0',description:'Maximum records'}},$defs:{__schema0:{type:'integer',minimum:1,maximum:20000}},additionalProperties:false} as unknown as ToolParameterSchema;
 const before=JSON.stringify(schema);const calls:unknown[]=[];const registry=new ToolRegistry();registry.register({name:'mcp_fixture_native',description:'Fixture',parameters:schema,requiresApproval:false,handler:async(args)=>{calls.push(args.max_records);return{ok:true,output:'Observed'};}});
 const dispatcher=new ToolDispatcher(registry,new AgentEmitter());
 const good=await dispatcher.dispatch('good','mcp_fixture_native','{"max_records":"50"}',[]);assert(good.ok);assert.deepEqual(calls,[50]);
 const bad=await dispatcher.dispatch('bad','mcp_fixture_native','{"max_records":"20001"}',[]);assert.equal(bad.ok,false);assert.equal(calls.length,1);assert.equal(JSON.stringify(schema),before);
});

test('unresolved/cyclic references do not trigger recursive conversion or fetches',async()=>{
 const schema={type:'object',properties:{value:{$ref:'#/$defs/loop'}},$defs:{loop:{$ref:'#/$defs/loop'}}} as unknown as ToolParameterSchema;
 const registry=new ToolRegistry();registry.register({name:'mcp_fixture_cycle',description:'Fixture',parameters:schema,requiresApproval:false,handler:async(args)=>({ok:true,output:JSON.stringify(args)})});
 const result=await new ToolDispatcher(registry,new AgentEmitter()).dispatch('cycle','mcp_fixture_cycle','{"value":"50"}',[]);assert(result.ok);assert.equal(result.output,'{"value":"50"}');
});
