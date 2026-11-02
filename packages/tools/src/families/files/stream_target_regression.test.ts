import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runWithWorkspaceRoot, setFileWriteStreamManifest } from '@liminal/core';
import { writeFileTool } from './write_file.js';
test('stream manifest cannot redirect an approved write outside the workspace', async () => {
 const base = await mkdtemp(path.join(os.tmpdir(), 'liminal-stream-'));
 const root=path.join(base,'workspace'), target=path.join(base,'outside.txt'), staged=path.join(base,'staged.txt');
 const old=process.env.AGENT_WORKSPACE_BOUND;
 try {
  await mkdir(root); await writeFile(target,'original'); await writeFile(staged,'replacement');
  process.env.AGENT_WORKSPACE_BOUND='1';
  setFileWriteStreamManifest({callId:'regression-manifest', stagingPath:staged, targetPath:target, mode:'overwrite',bytesWritten:11});
  const result=await runWithWorkspaceRoot(root,()=>writeFileTool.handler({path:'allowed.txt',content:'',mode:'overwrite',__harness_call_id:'regression-manifest'}));
  assert.equal(result.ok,false);
  assert.equal(await readFile(target,'utf8'),'original');
 } finally { if(old===undefined) delete process.env.AGENT_WORKSPACE_BOUND; else process.env.AGENT_WORKSPACE_BOUND=old; await rm(base,{recursive:true,force:true}); }
});
