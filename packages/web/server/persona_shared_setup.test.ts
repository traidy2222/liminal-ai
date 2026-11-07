import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {AgentHarness} from '@liminal/core';import {AgentBridge} from './agentBridge.js';
import {LIMINAL_DEFAULT_PROFILE} from '@liminal/tools';

test('an existing web chat clears stale onboarding state after global persona completion',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'liminal-web-persona-'));const before={...process.env};
 Object.assign(process.env,{AGENT_GLOBAL_STORAGE_ROOT:root,AGENT_WORKSPACE_ROOT:root,AGENT_PERSONA_BOOTSTRAP:'1',AGENT_PERSONA_BOOTSTRAP_FORCE:'0'});
 const harness=new AgentHarness({maxToolRoundsPerTurn:10,openRouterApiKey:'offline',model:'offline',baseURL:'http://127.0.0.1:1',worldContext:{disabled:true},proceduralMemory:{enabled:false},runtimePreferences:{version:1,updatedAt:0,persona:{bootstrapCompleted:false}},context:{inceptionMessages:[{role:'system',content:'Fixture'},{role:'system',content:'Protocol'}],modelMaxTokens:100000,thresholdFraction:0.9}});
 try{
  const profile={...LIMINAL_DEFAULT_PROFILE,name:'Sherlock Holmes'};const active=path.join(root,'persona','active');await mkdir(active,{recursive:true});await writeFile(path.join(active,'runtime_profile.json'),JSON.stringify(profile));
  const bridge=Object.create(AgentBridge.prototype) as any;bridge.workspaceRoot=root;bridge.harness=harness;bridge.awaitingPersonaBootstrapInput=true;bridge.bootstrapInFlight=false;
  await bridge.synchronizePreferences({version:1,updatedAt:1,persona:{bootstrapCompleted:true,sourcePrompt:'Sherlock Holmes',activeProfile:profile}});
  assert.equal(bridge.isAwaitingPersonaBootstrap,false);assert.equal(harness.getCurrentPersona()?.name,'Sherlock Holmes');
 }finally{harness.closeProcedureRuntime();process.env=before;await rm(root,{recursive:true,force:true});}
});
