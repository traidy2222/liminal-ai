import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { runWithWorkspaceRoot } from '@liminal/core';
import { writeFileTool } from './write_file.js';
test('write_file preserves intentional trailing quote or backtick content',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'liminal-complete-content-'));
 try{await runWithWorkspaceRoot(root,async()=>{
  for(const [i,content] of ['He said "hello"','A Markdown `code`'].entries()){
   const file=`file${i}.txt`,result=await writeFileTool.handler({path:file,content});
   assert.equal(result.ok,true,String(result.error));assert.equal(await readFile(path.join(root,file),'utf8'),content);
  }
 });}finally{await rm(root,{recursive:true,force:true});}
});
