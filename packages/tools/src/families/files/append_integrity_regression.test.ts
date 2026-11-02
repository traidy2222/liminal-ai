import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { runWithWorkspaceRoot, setFileWriteStreamManifest } from '@liminal/core';
import { writeFileTool } from './write_file.js';
for(const streamed of [false,true]) test(`append integrity detects corruption, streamed=${streamed}`,async(t)=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'liminal-append-integrity-')),target=path.join(root,'file.txt'),staged=path.join(root,'staged.txt');
 try{
  await fs.writeFile(target,'original');await fs.writeFile(staged,'added');
  t.mock.method(fs,'appendFile',async(file:any)=>{await fs.writeFile(file,'corrupted');});syncBuiltinESMExports();
  if(streamed)setFileWriteStreamManifest({callId:'append-integrity',targetPath:target,stagingPath:staged,mode:'append',bytesWritten:5});
  const result=await runWithWorkspaceRoot(root,()=>writeFileTool.handler({path:'file.txt',content:'added',mode:'append',...(streamed?{__harness_call_id:'append-integrity'}:{})}));
  assert.match(String(result.output??result.error),/integrity=mismatch/);
 }finally{t.mock.restoreAll();syncBuiltinESMExports();await fs.rm(root,{recursive:true,force:true});}
});
