import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {watchDesktopParent} from './desktop_parent.js';

for (const closedOutput of [false, true]) test(`desktop-owned sidecar exits after parent death${closedOutput ? ' with closed output pipes' : ' with ignored stdin'}`, async () => {
  const root=await mkdtemp(path.join(os.tmpdir(),'liminal-parent-'));
  const ready=path.join(root,'ready'), ended=path.join(root,'ended');
  const childCode=`import fs from 'node:fs';import {watchDesktopParent} from ${JSON.stringify(new URL('./desktop_parent.ts',import.meta.url).href)};import {ignoreBrokenParentPipe} from ${JSON.stringify(new URL('./parent_output.ts',import.meta.url).href)};ignoreBrokenParentPipe(process.stdout);ignoreBrokenParentPipe(process.stderr);watchDesktopParent(process.ppid,()=>{if(${closedOutput}){process.stdout.write('closing stdout');process.stderr.write('closing stderr');}setTimeout(()=>{fs.writeFileSync(${JSON.stringify(ended)},'parent exited');process.exit(0);},50);});fs.writeFileSync(${JSON.stringify(ready)},String(process.pid));setInterval(()=>{},1000);`;
  const parentCode=`import {spawn} from 'node:child_process';const child=spawn(process.execPath,['--import','tsx','--input-type','module','-e',${JSON.stringify(childCode)}],{stdio:${closedOutput ? "['ignore','pipe','pipe']" : "'ignore'"},detached:true,windowsHide:true});child.unref();setInterval(()=>{},1000);`;
  const parent=spawn(process.execPath,['--input-type','module','-e',parentCode],{stdio:'ignore',windowsHide:true});
  let childPid: number|undefined;
  async function waitFor(file: string): Promise<string> {
    for(let i=0;i<100;i++){try{return await readFile(file,'utf8');}catch{await new Promise(r=>setTimeout(r,50));}}
    throw Error(`Timed out waiting for ${path.basename(file)}`);
  }
  try {
    childPid=Number(await waitFor(ready));
    assert.ok(Number.isSafeInteger(childPid)&&childPid>1);
    const closed=new Promise<void>(resolve=>parent.once('exit',()=>resolve()));
    parent.kill();await closed;
    assert.equal(await waitFor(ended),'parent exited');
  } finally {
    parent.kill();
    if(childPid){try{process.kill(childPid);}catch{}}
    // Only remove the exact temporary fixture directory created by this test.
    assert.ok(path.resolve(root).startsWith(path.join(os.tmpdir(),'liminal-parent-')));
    await rm(root,{recursive:true,force:true});
  }
});

test('standalone servers and unrelated PID values do not opt into desktop shutdown', async () => {
  let calls=0;
  const stops=[NaN,0,1,-1,process.pid].map(pid=>watchDesktopParent(pid,()=>calls++));
  await new Promise(r=>setTimeout(r,550));
  stops.forEach(stop=>stop());
  assert.equal(calls,0);
});
