import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { runWithWorkspaceRoot } from '@liminal/core';
import { editFileTool } from './edit_file.js';
test('fuzzy full-file search does not repeatedly scan an ever-growing candidate list',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'liminal-diff-search-'));
 const includes=Array.prototype.includes;let scanned=0;
 try{await writeFile(path.join(root,'file.txt'),Array.from({length:10_000},(_,i)=>`line ${i}`).join('\n'));
  Array.prototype.includes=function(this:any[],value:any,from?:number){if(this.length>1000&&typeof this[0]==='number')scanned+=this.length;return includes.call(this,value,from);};
  const result=await runWithWorkspaceRoot(root,()=>editFileTool.handler({path:'file.txt',diff:'@@ -1 +1 @@\n-line 9999\n+changed',preview:true}));
  assert.ok(result.ok,String(result.error));assert.ok(scanned<500_000,`candidate membership scanned ${scanned} elements for 10000 lines`);
 }finally{Array.prototype.includes=includes;await rm(root,{recursive:true,force:true});}
});
