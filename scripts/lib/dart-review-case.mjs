import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
export function runDartReviewCase(name){
 const root=process.env.FLUTTER_ROOT||path.join(os.homedir(),'AppData/Local/flutter-sdk');
 const dart=path.join(root,'bin/cache/dart-sdk/bin',process.platform==='win32'?'dart.exe':'dart');
 const result=spawnSync(dart,[path.join(root,'bin/cache/flutter_tools.snapshot'),'test','--no-pub','test/speech_review_test.dart','--plain-name',name,'--reporter','expanded'],{
  cwd:path.resolve('apps/liminal_desktop'),env:{...process.env,FLUTTER_ROOT:root},windowsHide:true,encoding:'utf8',timeout:240000,maxBuffer:8*1024*1024,
 });
 assert.equal(result.status,0,(result.stdout+'\n'+result.stderr).slice(-6000));
 assert.match(result.stdout,/All tests passed/);
}
