import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {saveRuntimePreferences,loadRuntimePreferences,patchSavedRuntimePreferences} from '@liminal/core';
import {ChatRegistry} from './chat_registry.js';
import {LIMINAL_DEFAULT_PROFILE,LIMINAL_DEFAULT_CONTROLS} from '../../tools/src/families/harness_ui/persona_default.js';

test('persona completion survives stale chats, Mission Control, switching and restart',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'liminal-shared-persona-'));const before={...process.env};
 Object.assign(process.env,{AGENT_GLOBAL_STORAGE_ROOT:root,AGENT_WORKSPACE_ROOT:root,AGENT_PERSONA_BOOTSTRAP:'1',AGENT_PERSONA_BOOTSTRAP_FORCE:'0',AGENT_SESSION_GREET:'0',AGENT_AUTO_DREAM:'0',AGENT_TRAJECTORY_WRITE:'0'});
 const provider={apiKey:'offline',model:'offline',baseURL:'https://example.invalid/v1'};
 const registry=new ChatRegistry({provider,runtimePreferences:null,repoRoot:root,sink:()=>{}});
 let restarted:ChatRegistry|undefined;
 try{
  await saveRuntimePreferences({version:1,updatedAt:0,persona:{bootstrapCompleted:false}},root);
  const first=await registry.getOrCreateActive();const stale=await registry.create({workspaceRoot:root});
  assert.equal(first.isAwaitingPersonaBootstrap,true);assert.equal(stale.isAwaitingPersonaBootstrap,true);
  const profile={...LIMINAL_DEFAULT_PROFILE,name:'Sherlock Holmes',generationSourceHint:'Sherlock Holmes',strength:5};
  const active=path.join(root,'persona','active');await mkdir(active,{recursive:true});await writeFile(path.join(active,'runtime_profile.json'),JSON.stringify(profile));
  // An older busy chat must not restore its stale onboarding snapshot when it saves a setting.
  (stale.harness as any).running=true;
  await first.harness.patchRuntimePreferences({persona:{bootstrapCompleted:true,sourcePrompt:'Sherlock Holmes',activeProfile:profile,controls:LIMINAL_DEFAULT_CONTROLS}},{persist:true});
  assert.equal(registry.getRuntimePreferences()?.persona?.activeProfile?.name,'Sherlock Holmes');
  await stale.harness.patchRuntimePreferences({harness:{env:{AGENT_TTS_ENABLED:'0'}}},{persist:true});
  (stale.harness as any).running=false;
  await registry.activate(stale.chatId);
  assert.equal(stale.isAwaitingPersonaBootstrap,false);assert.equal(stale.harness.getCurrentPersona()?.name,'Sherlock Holmes');
  const mission=await registry.getOrCreateOrchestratorChat({activate:false});
  assert.equal(mission.isAwaitingPersonaBootstrap,false);assert.equal(mission.harness.getCurrentPersona()?.name,'Sherlock Holmes');
  const next=await registry.create({workspaceRoot:root});assert.equal(next.isAwaitingPersonaBootstrap,false);
  assert.equal((await loadRuntimePreferences(root))?.persona?.activeProfile?.name,'Sherlock Holmes');
  await Promise.all([patchSavedRuntimePreferences({runtime:{uiVerbosity:'quiet'}},root),patchSavedRuntimePreferences({harness:{env:{AGENT_TTS_ENABLED:'1'}}},root)]);
  assert.equal((await loadRuntimePreferences(root))?.persona?.bootstrapCompleted,true);
  registry.disposeAll();
  restarted=new ChatRegistry({provider,runtimePreferences:await loadRuntimePreferences(root),repoRoot:root,sink:()=>{}});
  const resumed=await restarted.getOrCreateActive();assert.equal(resumed.isAwaitingPersonaBootstrap,false);assert.equal(resumed.harness.getCurrentPersona()?.name,'Sherlock Holmes');
 }finally{registry.disposeAll();restarted?.disposeAll();process.env=before;await rm(root,{recursive:true,force:true});}
});
