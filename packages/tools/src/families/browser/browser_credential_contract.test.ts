import test from 'node:test';import assert from 'node:assert/strict';
import {ToolRegistry,ToolDispatcher,AgentEmitter} from '@liminal/core';
import {browserCredentialsTool} from '../../../dist/families/browser/browser_tools.js';
test('credential action variants reject mixed arguments and require evidence before handlers run',async()=>{
 const registry=new ToolRegistry();let calls=0;registry.register({...browserCredentialsTool,name:'credential_fixture',handler:async()=>{calls++;return {ok:true,output:'validated'};}});const dispatcher=new ToolDispatcher(registry,new AgentEmitter());
 for(const args of [{action:'record_account',credential_id:'known',password_ref:'e1'},{action:'fill',credential_id:'known'},{action:'prepare'},{action:'accounts',password_ref:'e1'}]){
  const result=await dispatcher.dispatch('bad','credential_fixture',JSON.stringify(args));assert.equal(result.ok,false);
 }
 assert.equal(calls,0);
 for(const args of [{action:'record_account',username:'assistant@example.test',owner:'assistant',login_method:'email_code',evidence:'Signed in successfully'},{action:'record_account',username:'assistant@example.test',evidence:'Signed in successfully'},{action:'fill',credential_id:'known',password_ref:'e1'},{action:'accounts'}])assert.equal((await dispatcher.dispatch('good','credential_fixture',JSON.stringify(args))).ok,true);
 assert.equal(calls,4);assert.equal(registry.toOpenAIFormat()[0]!.function.parameters.anyOf.length,5);
});
