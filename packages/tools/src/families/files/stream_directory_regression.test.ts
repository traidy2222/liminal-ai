import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { runWithWorkspaceRoot } from '@liminal/core';
import { promoteStagingFile } from './file_write_ops.js';
test('streamed writes create nested destination directories',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'liminal-promote-'));
 try{const staged=path.join(root,'staged'); await writeFile(staged,'hello');
 await runWithWorkspaceRoot(root,()=>promoteStagingFile(staged,path.join(root,'new','nested','file.txt'),'create'));
 assert.equal(await readFile(path.join(root,'new','nested','file.txt'),'utf8'),'hello');
 }finally{await rm(root,{recursive:true,force:true});}
});
