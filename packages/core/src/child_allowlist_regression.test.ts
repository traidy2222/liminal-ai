import test from 'node:test';
import assert from 'node:assert/strict';
import { ToolRegistry } from './registry.js';
import { finalizeChildSpawnTools } from './spawn_provisioning.js';
test('final child provisioning removes unrequested tools added by creation hooks',()=>{
 const registry=new ToolRegistry();
 for(const name of ['read_file','write_file','share_agent_context','read_agent_context','set_runtime_settings','spawn_agent','run_shell'])registry.register({name,description:'test',requiresApproval:false,parameters:{type:'object',properties:{}},handler:async()=>({ok:true,output:''})});
 finalizeChildSpawnTools(registry,{goal:'inspect source',toolNames:['read_file']},{canOrchestrate:true});
 for(const name of ['set_runtime_settings','spawn_agent','run_shell'])assert.equal(registry.has(name),false,name);
 for(const name of ['read_file','write_file','share_agent_context','read_agent_context'])assert.equal(registry.has(name),true,name);
});
