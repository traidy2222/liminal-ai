import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { runWithWorkspaceRoot } from '@liminal/core';
import { runBrowserActions, buildPageSnapshot } from './browser_runtime.js';
test('in-page file navigation is checked before further actions or snapshot reads',async()=>{
 const parent=await mkdtemp(path.join(os.tmpdir(),'liminal-file-nav-')),root=path.join(parent,'root'),secret=path.join(parent,'secret.txt');
 try{await mkdir(root);await writeFile(secret,'synthetic');let url='https://example.invalid',reads=0;
 const page={url:()=>url,locator:()=>({click:async()=>{url=pathToFileURL(secret).href;}}),evaluate:async()=>{reads++;return [];},accessibility:{snapshot:async()=>{reads++;return null;}}};
 await runWithWorkspaceRoot(root,async()=>{
  await assert.rejects(runBrowserActions({page,refs:new Map()} as any,[{op:'click_selector',selector:'a'}]),/outside workspace/);
  await assert.rejects(buildPageSnapshot(page as any),/outside workspace/);
 });assert.equal(reads,0);
 }finally{await rm(parent,{recursive:true,force:true});}
});
