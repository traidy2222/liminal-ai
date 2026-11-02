import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { runWithWorkspaceRoot } from '@liminal/core';
import { promoteStagingFile } from './file_write_ops.js';
test('successful promotion removes staging while failed promotion preserves it',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'liminal-staging-'));
 try{const staged=path.join(root,'staged'),target=path.join(root,'file.txt'); await writeFile(staged,'hello');
 await runWithWorkspaceRoot(root,()=>promoteStagingFile(staged,target,'create'));
 await assert.rejects(access(staged),{code:'ENOENT'});
 await writeFile(staged,'again');
 await assert.rejects(runWithWorkspaceRoot(root,()=>promoteStagingFile(staged,target,'create')));
 assert.equal(await readFile(staged,'utf8'),'again');
 }finally{await rm(root,{recursive:true,force:true});}
});
