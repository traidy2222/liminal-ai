import test from 'node:test';import assert from 'node:assert/strict';import {ToolRegistry,ToolDispatcher,AgentEmitter} from '@liminal/core';import {BROWSER_ACTION_SCHEMA} from '../../../dist/families/browser/browser_tools.js';import {normalizeOneAction} from '../../../dist/families/browser/browser_runtime.js';
test('op-less waits normalize safely without inferring mutating operations',async()=>{
 const parsed=normalizeOneAction({wait_ms:2500});assert.deepEqual(parsed,{op:{op:'wait_ms',ms:2500}});
 const registry=new ToolRegistry();let calls=0;registry.register({name:'action_fixture',description:'fixture',requiresApproval:false,parameters:{type:'object',properties:{actions:{type:'array',items:BROWSER_ACTION_SCHEMA}},required:['actions']},handler:async()=>{calls++;return {ok:true,output:'validated'};}});const dispatcher=new ToolDispatcher(registry,new AgentEmitter());
 assert.equal((await dispatcher.dispatch('valid','action_fixture',JSON.stringify({actions:[{wait_ms:2500}]}))).ok,true);
 assert.deepEqual(normalizeOneAction({op:'wait_ms',value:1500}),{op:{op:'wait_ms',ms:1500}});
 assert.equal((await dispatcher.dispatch('alias','action_fixture',JSON.stringify({actions:[{op:'wait_ms',value:1500}]}))).ok,true);
 assert.deepEqual(normalizeOneAction({op:'wait_ms',wait_ms:800}),{op:{op:'wait_ms',ms:800}});
 assert.equal((await dispatcher.dispatch('alias-wait','action_fixture',JSON.stringify({actions:[{op:'wait_ms',wait_ms:800}]}))).ok,true);
 for(const action of [{wait_ms:-1},{wait_ms:2500,url:'https://example.test'},{url:'https://example.test'},{}])assert.equal((await dispatcher.dispatch('bad','action_fixture',JSON.stringify({actions:[action]}))).ok,false);
 assert.equal((await dispatcher.dispatch('conflicting','action_fixture',JSON.stringify({actions:[{op:'wait_ms',value:1500,ms:10}]}))).ok,false);
 assert.equal(calls,3);
});
