import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {atomicWriteText} from '../../shared/atomic_file_write.js';
test('atomic writes refuse to silently break a hard-linked file',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'liminal-hardlink-')),target=path.join(root,'target'),alias=path.join(root,'alias');
 try{await fs.writeFile(target,'before');await fs.link(target,alias);await assert.rejects(atomicWriteText(alias,'after'),/hard.link/i);
 assert.equal(await fs.readFile(target,'utf8'),'before');assert.equal(await fs.readFile(alias,'utf8'),'before');
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('atomic writes refuse to replace a dangling symlink',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'liminal-dangling-')),target=path.join(root,'target'),alias=path.join(root,'alias');
 try{await fs.symlink(target,alias,'file');await assert.rejects(atomicWriteText(alias,'after'),/dangling/i);assert.equal((await fs.lstat(alias)).isSymbolicLink(),true);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
