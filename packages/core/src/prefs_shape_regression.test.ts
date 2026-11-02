import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { loadRuntimePreferences, getRuntimePrefsPath } from './runtime_prefs.js';
test('malformed persisted provider, harness and runtime fields cannot reach typed consumers',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'liminal-prefs-shape-'));const old=process.env.AGENT_STORAGE_LAYOUT;
 try{process.env.AGENT_STORAGE_LAYOUT='legacy';
 for(const patch of [{provider:{model:42}},{provider:{baseURL:[]}},{harness:{env:{AGENT_EFFORT:3}}},{harness:{env:[]}},{runtime:{approvalTimeoutMs:'oops'}},{runtime:{rateLimitMaxRetries:-1}},{provider:{inferenceMode:'unknown'}}]){
  await writeFile(getRuntimePrefsPath(root),JSON.stringify({version:1,updatedAt:1,...patch}));
  assert.equal(await loadRuntimePreferences(root),null,JSON.stringify(patch));
 }
 await writeFile(getRuntimePrefsPath(root),JSON.stringify({version:1,updatedAt:1,provider:{model:'model'},runtime:{rateLimitMaxRetries:0},harness:{env:{AGENT_EFFORT:'high'}}}));
 assert.equal((await loadRuntimePreferences(root))?.provider?.model,'model');
 }finally{if(old===undefined)delete process.env.AGENT_STORAGE_LAYOUT;else process.env.AGENT_STORAGE_LAYOUT=old;await rm(root,{recursive:true,force:true});}
});
