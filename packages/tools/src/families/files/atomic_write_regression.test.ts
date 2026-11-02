import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { runWithWorkspaceRoot } from '@liminal/core';
import { commitContent } from './file_write_ops.js';
import { editFileTool } from './edit_file.js';
test('failed overwrite and edit preserve the original file',async(t)=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'liminal-atomic-')), target=path.join(root,'file.txt');
 const original=fs.writeFile;
 try{await original(target,'original');
  t.mock.method(fs,'writeFile',async(file:any,_content:any,options:any)=>{await original(file,'partial',options);throw new Error('simulated disk failure');});syncBuiltinESMExports();
  await assert.rejects(commitContent(target,'replacement','overwrite'),/disk failure/);
  assert.equal(await fs.readFile(target,'utf8'),'original');
  const result=await runWithWorkspaceRoot(root,()=>editFileTool.handler({path:'file.txt',replacements:[{search:'original',replace:'replacement'}]}));
  assert.equal(result.ok,false);assert.equal(await fs.readFile(target,'utf8'),'original');
  assert.deepEqual(await fs.readdir(root),['file.txt']);
 }finally{t.mock.restoreAll();syncBuiltinESMExports();await fs.rm(root,{recursive:true,force:true});}
});
test('create cannot clobber a file created after preflight',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'liminal-create-race-')), target=path.join(root,'file.txt');
 try{await fs.writeFile(target,'original');await assert.rejects(commitContent(target,'replacement','create'));assert.equal(await fs.readFile(target,'utf8'),'original');}
 finally{await fs.rm(root,{recursive:true,force:true});}
});
