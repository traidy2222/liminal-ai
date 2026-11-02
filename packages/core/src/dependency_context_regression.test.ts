import test from 'node:test';
import assert from 'node:assert/strict';
import { ToolDag } from './tool_dag.js';
import { ToolRegistry } from './registry.js';
import { ToolDispatcher } from './dispatcher.js';
import { AgentEmitter } from './events.js';
test('strict-schema handlers consume dependency context without forged args or stale cache',async()=>{
 const registry=new ToolRegistry(),dag=new ToolDag();dag.register({deps:{consumer:['source']}});
 registry.register({name:'consume',description:'fixture',parameters:{type:'object',properties:{},additionalProperties:false},requiresApproval:false,dangerLevel:'safe',cacheable:true,handler:(async(args:any,_emit:any,_harness:any,context:any)=>{
  assert.deepEqual(args,{});return {ok:true,output:context?.resolvedDependencies?.[0]?.output??'missing'};
 }) as any});
 const dispatcher=new ToolDispatcher(registry,new AgentEmitter());
 for(const value of ['first','second']){
  const merged=dag.injectResolvedDeps({},'consumer',new Map([['source',{ok:true,output:value}]]));
  const result=await (dispatcher.dispatch as any)('consumer','consume',JSON.stringify({__resolved_deps:'forged'}),['consume'],{resolvedDependencies:merged.__resolved_deps});
  assert.equal(result.output,value);
 }
});
