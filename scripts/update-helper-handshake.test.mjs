import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
import {extractAppArchive} from './lib/update-release.mjs';

function fixture(t, exited) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'liminal helper handshake '));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.copyFileSync('scripts/apply-desktop-update.mjs',path.join(root,'apply-desktop-update.mjs'));
  fs.writeFileSync(path.join(root,'update-release.mjs'), `
export function waitForProcessExit(pid){return ${exited};}
export async function extractAppArchive(){return 'fixture';}
export function applyHarnessSwap(){}
export async function extractLiminaldFromArchive(){}
`);
  fs.writeFileSync(path.join(root,'apply-app-swap.mjs'), `
import fs from 'node:fs';
export async function applyAppFolderSwap({exeDir}){fs.writeFileSync(exeDir+'/applied','yes');}
export async function relaunchInstalledApp(){}
`);
  fs.writeFileSync(path.join(root,'pending_update.json'),'{}');
  return {root,args:[path.join(root,'apply-desktop-update.mjs'),'--mode','app','--exe-dir',root,'--archive',path.join(root,'fixture.zip'),'--platform','windows','--relaunch-pid','2147483647','--ready-file',path.join(root,'ready')]};
}

test('real updater acknowledges initialization and clears pending state after success',t=>{
  const {root,args}=fixture(t,true);
  execFileSync(process.execPath,args,{stdio:'pipe',timeout:10000,windowsHide:true});
  assert.equal(fs.readFileSync(path.join(root,'ready'),'utf8'),'ready');
  assert.equal(fs.readFileSync(path.join(root,'applied'),'utf8'),'yes');
  assert.equal(fs.existsSync(path.join(root,'pending_update.json')),false);
});

test('updater refuses to replace files while the current app is still running',t=>{
  const {root,args}=fixture(t,false);
  const result=spawnSync(process.execPath,args,{encoding:'utf8',timeout:10000,windowsHide:true});
  assert.equal(result.status,1);
  assert.match(result.stderr,/Timed out waiting for the current app to exit/);
  assert.equal(fs.existsSync(path.join(root,'applied')),false);
  assert.equal(fs.existsSync(path.join(root,'pending_update.json')),true);
});

test('Windows extraction reads a real ZIP using paths containing spaces', {skip:process.platform!=='win32'}, async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'liminal zip fixture '));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.writeFileSync(path.join(root,'payload.txt'),'verified fixture bytes');
  const archive=path.join(root,'update archive.zip');
  execFileSync('tar.exe',['-a','-cf',archive,'-C',root,'payload.txt'],{stdio:'pipe',windowsHide:true,timeout:10000});
  const extracted=await extractAppArchive(root,archive,'windows');
  assert.ok(path.resolve(extracted).startsWith(path.join(os.tmpdir(),'liminal-app-update-')));
  t.after(()=>fs.rmSync(extracted,{recursive:true,force:true}));
  assert.equal(fs.readFileSync(path.join(extracted,'payload.txt'),'utf8'),'verified fixture bytes');
});
