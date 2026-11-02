import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assertFileMayBeOpened } from './browser_runtime.js';
import { runWithWorkspaceRoot, runHarnessEffectiveEnvContext } from '@liminal/core';
test('an explicit file root on a different Windows drive remains intact',async(t)=>{
 const root=process.platform==='win32'?'C:\\workspace':'/workspace';
 const extra=process.platform==='win32'?'Z:\\approved':'/approved';
 const file=extra+(process.platform==='win32'?'\\index.html':'/index.html');
 t.mock.method(fs,'existsSync',()=>true);
 t.mock.method(fs,'realpathSync',(p:any)=>String(p));
 await runWithWorkspaceRoot(root,()=>runHarnessEffectiveEnvContext({harness:{env:{AGENT_BROWSER_FILE_ROOT:extra,AGENT_BROWSER_ALLOW_FILE_ANY:'0'}}} as any,()=>assert.ok(assertFileMayBeOpened(file).ok)));
});
