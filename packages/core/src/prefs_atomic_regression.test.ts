import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { saveRuntimePreferences, getRuntimePrefsPath } from './runtime_prefs.js';
test('concurrent preference readers never observe a truncated JSON file',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'liminal-atomic-prefs-'));const old=process.env.AGENT_STORAGE_LAYOUT;
 try{process.env.AGENT_STORAGE_LAYOUT='legacy';
 const prefs={version:1,updatedAt:1,harness:{env:{FIXTURE:'x'.repeat(2_000_000)}}} as const;
 await saveRuntimePreferences(prefs,root);const file=getRuntimePrefsPath(root);
 let malformed=false;
 for(let i=0;i<8;i++){
  const writing=saveRuntimePreferences({...prefs,updatedAt:i},root);
  for(let j=0;j<4;j++){const raw=await readFile(file,'utf8');try{JSON.parse(raw);}catch{malformed=true;}}
  await writing;
 }
 assert.equal(malformed,false);
 }finally{if(old===undefined)delete process.env.AGENT_STORAGE_LAYOUT;else process.env.AGENT_STORAGE_LAYOUT=old;await rm(root,{recursive:true,force:true});}
});
