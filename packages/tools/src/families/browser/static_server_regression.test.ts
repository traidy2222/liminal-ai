import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { startStaticFileServer, assertFileMayBeOpened } from './browser_runtime.js';
import { runWithWorkspaceRoot, runHarnessEffectiveEnvContext } from '@liminal/core';

test('static preview rejects malformed escapes without throwing',async(t)=>{
 let handler:any;
 t.mock.method(http,'createServer',(callback:any)=>{handler=callback;return {once(){},listen(_port:any,_host:any,ready:any){ready();},address(){return {port:12345};}};});
 syncBuiltinESMExports();
 try{
  assert.ok((await startStaticFileServer({ownerTaskId:'malformed-test',rootDir:os.tmpdir()})).ok);
  const res={statusCode:200,end(_text?:string){}};
  assert.doesNotThrow(()=>handler({url:'/%E0%A4%A'},res));
  assert.equal(res.statusCode,400);
 }finally{t.mock.restoreAll();syncBuiltinESMExports();}
});
test('static preview never reads through a symlink outside its root',async(t)=>{
 const parent=await mkdtemp(path.join(os.tmpdir(),'liminal-static-'));
 let handler:any,read=false;
 t.mock.method(http,'createServer',(callback:any)=>{handler=callback;return {once(){},listen(_port:any,_host:any,ready:any){ready();},address(){return {port:12345};}};});
 t.mock.method(fs,'createReadStream',()=>{read=true;return {on(){return this;},pipe(){}} as any;});
 syncBuiltinESMExports();
 try{
  const root=path.join(parent,'root'),outside=path.join(parent,'outside');await mkdir(root);await mkdir(outside);await writeFile(path.join(outside,'secret.txt'),'synthetic-secret');
  await symlink(outside,path.join(root,'link'),process.platform==='win32'?'junction':'dir');
  assert.ok((await startStaticFileServer({ownerTaskId:'symlink-test',rootDir:root})).ok);
  const res={statusCode:200,end(_text?:string){}};handler({url:'/link/secret.txt'},res);
  assert.equal(read,false,'outside bytes must not be opened');assert.equal(res.statusCode,404);
 }finally{t.mock.restoreAll();syncBuiltinESMExports();await rm(parent,{recursive:true,force:true});}
});
test('explicit browser file roots preserve platform drive letters',async()=>{
 const parent=await mkdtemp(path.join(os.tmpdir(),'liminal-file-roots-'));
 try{
  const root=path.join(parent,'root'),extra=path.join(parent,'extra');await mkdir(root);await mkdir(extra);const file=path.join(extra,'index.html');await writeFile(file,'hello');
  await runWithWorkspaceRoot(root,()=>runHarnessEffectiveEnvContext({harness:{env:{AGENT_BROWSER_FILE_ROOT:extra,AGENT_BROWSER_ALLOW_FILE_ANY:'0'}}} as any,()=>assert.ok(assertFileMayBeOpened(file).ok)));
 }finally{await rm(parent,{recursive:true,force:true});}
});
