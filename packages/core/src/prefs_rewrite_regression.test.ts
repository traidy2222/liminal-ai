import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { loadRuntimePreferences,getRuntimePrefsPath } from './runtime_prefs.js';
test('unwritable legacy secret cleanup still returns valid sanitized preferences',async(t)=>{
 const old=process.env.AGENT_STORAGE_LAYOUT;process.env.AGENT_STORAGE_LAYOUT='legacy';
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'liminal-readonly-prefs-'));
 try {
  await fs.writeFile(getRuntimePrefsPath(root),JSON.stringify({version:1,updatedAt:1,harness:{env:{AGENT_API_KEY:'synthetic',AGENT_EFFORT:'high'}}}));
  t.mock.method(fs,'writeFile',async()=>{throw Object.assign(Error('read only'),{code:'EROFS'});});syncBuiltinESMExports();
  const prefs=await loadRuntimePreferences(root);
  assert.ok(prefs);assert.equal(prefs.harness?.env?.AGENT_API_KEY,undefined);assert.equal(prefs.harness?.env?.AGENT_EFFORT,'high');
 } finally {t.mock.restoreAll();syncBuiltinESMExports();if(old===undefined)delete process.env.AGENT_STORAGE_LAYOUT;else process.env.AGENT_STORAGE_LAYOUT=old;await fs.rm(root,{recursive:true,force:true});}
});
