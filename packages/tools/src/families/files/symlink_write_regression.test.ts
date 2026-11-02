import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { atomicWriteText } from '../../shared/atomic_file_write.js';
test('atomic overwrite follows an existing file symlink without replacing it',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'liminal-link-write-'));const target=path.join(root,'target'),alias=path.join(root,'alias');
 try{await fs.writeFile(target,'before');await fs.symlink(target,alias,'file');await atomicWriteText(alias,'after');
 assert.equal(await fs.readFile(target,'utf8'),'after');assert.equal((await fs.lstat(alias)).isSymbolicLink(),true);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
