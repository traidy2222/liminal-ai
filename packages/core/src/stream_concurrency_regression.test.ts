import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { runWithWorkspaceRoot } from './workspace_root.js';
import { FileWriteStreamSink } from './file_write_stream_sink.js';
test('concurrent argument deltas finish staging before finalize returns',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'liminal-stream-queue-'));
 try{await runWithWorkspaceRoot(root,async()=>{
  const sink=new FileWriteStreamSink(true,1), content='first second third '.repeat(1000);
  const raw=JSON.stringify({path:'output.txt',content});const pending:Promise<void>[]=[];
  for(let i=0;i<raw.length;i+=23) pending.push(sink.ingestDelta('concurrent','write_file',raw.slice(i,i+23)));
  await sink.finalize('concurrent');await Promise.all(pending);
  const staged=sink.takeForDispatch('concurrent');assert.ok(staged);
  assert.equal(await readFile(staged.stagingPath,'utf8'),content);
 });}finally{await rm(root,{recursive:true,force:true});}
});
