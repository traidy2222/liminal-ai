import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';
import { runWithWorkspaceRoot } from '@liminal/core';
import { openBrowserSession, closeBrowserSession, refreshBrowserEmbedView, saveCookieProfile, shutdownBrowserWorkspace } from './browser_runtime.js';
function fakeBrowser(t:any){
 const page={setDefaultTimeout(){},setDefaultNavigationTimeout(){},on(){},goto:async()=>{},url:()=> 'https://example.invalid',title:async()=> 'test',innerText:async()=> 'body',evaluate:async()=>null,screenshot:async()=>Buffer.alloc(128),viewportSize:()=>({width:800,height:600}),close:async()=>{},isClosed:()=>false};
 const browser={close:async()=>{}};
 const context={browser:()=>browser,on(){},addInitScript:async()=>{},newPage:async()=>page,close:async()=>{},cookies:async()=>[{name:'session',value:'synthetic'}]};
 t.mock.method(chromium,'launchPersistentContext',async()=>context as any);
}
const options={ownerTaskId:'artifact-regression',href:'https://example.invalid',waitUntil:'load' as const,navTimeoutMs:100,postWaitMs:0,includeConsole:false,includeSnapshot:false};
test('preview refreshes retain at most one disk frame per session and remove it on close',async(t)=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'liminal-panel-'));fakeBrowser(t);
 const prior=process.env.LIMINAL_BROWSER_DATA_DIR;process.env.LIMINAL_BROWSER_DATA_DIR=root;
 t.after(async()=>{await shutdownBrowserWorkspace();await rm(root,{recursive:true,force:true});if(prior===undefined)delete process.env.LIMINAL_BROWSER_DATA_DIR;else process.env.LIMINAL_BROWSER_DATA_DIR=prior;});
 try{await runWithWorkspaceRoot(root,async()=>{
  const opened=await openBrowserSession(options);assert.ok(opened.ok);
  try{for(let i=0;i<4;i++){await new Promise(r=>setTimeout(r,3));await refreshBrowserEmbedView(opened.sessionId);}
   assert.equal((await readdir(path.join(root,'.agent_artifacts','browser'))).filter(f=>f.endsWith('.jpg')).length,1);
  }finally{await closeBrowserSession({sessionId:opened.sessionId});}
  assert.equal((await readdir(path.join(root,'.agent_artifacts','browser'))).filter(f=>f.endsWith('.jpg')).length,0);
 });}finally{await rm(root,{recursive:true,force:true});}
});
test('cookie profiles request owner-only file and directory permissions',async(t)=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'liminal-cookies-'));fakeBrowser(t);
 const prior=process.env.LIMINAL_BROWSER_DATA_DIR;process.env.LIMINAL_BROWSER_DATA_DIR=root;
 t.after(async()=>{await shutdownBrowserWorkspace();await rm(root,{recursive:true,force:true});if(prior===undefined)delete process.env.LIMINAL_BROWSER_DATA_DIR;else process.env.LIMINAL_BROWSER_DATA_DIR=prior;});
 const chmod=t.mock.method(fs,'chmodSync',fs.chmodSync),write=t.mock.method(fs,'writeFileSync',fs.writeFileSync);
 try{await runWithWorkspaceRoot(root,async()=>{
  const opened=await openBrowserSession(options);assert.ok(opened.ok);
  try{const result=await saveCookieProfile(opened.sessionId,'profile');assert.ok(result.ok);
   const calls=chmod.mock.calls.map(c=>c.arguments as any[]);assert.ok(calls.some(c=>String(c[0]).endsWith('browser_cookies')&&c[1]===0o700));
   const writes=write.mock.calls.map(c=>c.arguments as any[]);assert.ok(writes.some(c=>String(c[0]).endsWith('profile.json')&&c[2]?.mode===0o600));
  }finally{await closeBrowserSession({sessionId:opened.sessionId});}
 });}finally{await rm(root,{recursive:true,force:true});}
});
