import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { runWithWorkspaceRoot } from '@liminal/core';
import { editFileTool } from './edit_file.js';
test('diff retains content lines beginning with double minus or plus',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'liminal-diff-'));
 try{await writeFile(path.join(root,'file.txt'),'--old\n');
 const result=await runWithWorkspaceRoot(root,()=>editFileTool.handler({path:'file.txt',diff:'@@ -1 +1 @@\n---old\n+++new'}));
 assert.equal(result.ok,true);assert.equal(await readFile(path.join(root,'file.txt'),'utf8'),'++new\n');
 }finally{await rm(root,{recursive:true,force:true});}
});
