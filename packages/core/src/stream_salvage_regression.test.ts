import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { runWithWorkspaceRoot } from './workspace_root.js';
import { FileWriteStreamSink } from './file_write_stream_sink.js';
test('incomplete stream salvage never writes an unapproved target',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'liminal-salvage-'));
 try { await runWithWorkspaceRoot(root,async()=>{
  const target=path.join(root,'existing.txt');await writeFile(target,'original');
  const sink=new FileWriteStreamSink(true,1);
  await sink.ingestDelta('fixture','write_file',JSON.stringify({path:target,mode:'create',content:'unapproved'}));
  await sink.salvagePartialToTarget('fixture');
  assert.equal(await readFile(target,'utf8'),'original');
  const staged=sink.takeForDispatch('fixture');assert.ok(staged);
  assert.equal(await readFile(staged.stagingPath,'utf8'),'unapproved');
 }); }finally{await rm(root,{recursive:true,force:true});}
});
