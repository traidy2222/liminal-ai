import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { loadRuntimePreferences, saveRuntimePreferences, getRuntimePrefsPath } from './runtime_prefs.js';
test('legacy preferences discard inference credentials on load and save',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'liminal-legacy-token-'));const old=process.env.AGENT_STORAGE_LAYOUT;
 try{process.env.AGENT_STORAGE_LAYOUT='legacy';
 const file=getRuntimePrefsPath(root);await writeFile(file,JSON.stringify({version:1,updatedAt:1,harness:{env:{AGENT_INFERENCE_SESSION_TOKEN:'synthetic-legacy-token',AGENT_EFFORT:'high'}}}));
 const loaded=await loadRuntimePreferences(root);assert.ok(loaded);
 assert.equal(loaded.harness?.env?.AGENT_INFERENCE_SESSION_TOKEN,undefined);
 await saveRuntimePreferences({...loaded,updatedAt:2},root);
 const persisted=JSON.parse(await readFile(file,'utf8'));
 assert.equal(persisted.harness.env.AGENT_INFERENCE_SESSION_TOKEN,undefined);
 assert.equal(persisted.harness.env.AGENT_EFFORT,'high');
 }finally{if(old===undefined)delete process.env.AGENT_STORAGE_LAYOUT;else process.env.AGENT_STORAGE_LAYOUT=old;await rm(root,{recursive:true,force:true});}
});
