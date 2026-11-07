import test from 'node:test';import assert from 'node:assert/strict';import {ToolRegistry,AgentEmitter} from '@liminal/core';import {createMcpAttachTools} from './mcp_attach.js';
test('explicit built-in lookup activates only the native tool instead of fuzzy unrelated MCP tools',async()=>{
 const registry=new ToolRegistry();registry.setLazyToolLoading(true);const definition={description:'fixture',requiresApproval:false,parameters:{type:'object' as const,properties:{}},handler:async()=>({ok:true as const,output:'unused'})};registry.register({...definition,name:'browser_credentials'});registry.register({...definition,name:'mcp_rea_capture_browser_scenario'});
 const search=createMcpAttachTools(registry,new AgentEmitter()).mcpSearchToolsTool;
 const preview=await search.handler({query:'browser_credentials accounts',activate:false});assert.ok(preview.ok);assert.equal(registry.isActive('browser_credentials'),false);
 const result=await search.handler({query:'browser_credentials accounts'});assert.ok(result.ok);const body=JSON.parse(result.output);assert.deepEqual(body.matches.map((m:any)=>m.name),['browser_credentials']);assert.equal(body.matches[0].connection,'builtin');assert.equal(registry.isActive('browser_credentials'),true);assert.equal(registry.isActive('mcp_rea_capture_browser_scenario'),false);
});

test('native family capability searches load browser operations before unrelated browser debuggers',async()=>{
 const registry=new ToolRegistry();registry.setLazyToolLoading(true);const definition={requiresApproval:false,parameters:{type:'object' as const,properties:{}},handler:async()=>({ok:true as const,output:'unused'})};
 registry.register({...definition,name:'browser_snapshot',description:'Observe the current browser page snapshot'});registry.register({...definition,name:'browser_act',description:'Click controls in the current browser page'});registry.register({...definition,name:'mcp_rea_list_browser_targets',description:'Find browser debugging targets'});registry.setToolFamilyLookup(new Map([['browser_snapshot','browser'],['browser_act','browser']]));
 const search=createMcpAttachTools(registry,new AgentEmitter()).mcpSearchToolsTool;
 const result=await search.handler({query:'browser click evaluate snapshot'});assert.ok(result.ok);const body=JSON.parse(result.output);assert.equal(body.matches[0].name,'browser_snapshot');assert.ok(body.matches.every((m:any)=>m.connection==='builtin'));assert.equal(registry.isActive('mcp_rea_list_browser_targets'),false);
 const scoped=await search.handler({query:'browser snapshot',connection:'missing-fixture',activate:false});assert.ok(scoped.ok);assert.deepEqual(JSON.parse(scoped.output).matches,[]);
});
