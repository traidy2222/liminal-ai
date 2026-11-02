import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { runWithWorkspaceRoot } from '@liminal/core';
import { editFileTool } from './edit_file.js';
test('multi-hunk input cannot silently apply only the first hunk',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'liminal-hunks-'));
 try{await writeFile(path.join(root,'file.txt'),'one\ntwo\n');
 const result=await runWithWorkspaceRoot(root,()=>editFileTool.handler({path:'file.txt',diff:'@@ -1 +1 @@\n-one\n+ONE\n@@ -2 +2 @@\n-two\n+TWO'}));
 const content=await readFile(path.join(root,'file.txt'),'utf8');
 assert.ok(result.ok ? content==='ONE\nTWO\n' : content==='one\ntwo\n', 'apply all hunks or reject without edits');
 }finally{await rm(root,{recursive:true,force:true});}
});
