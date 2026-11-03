import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,readFile,writeFile,rm}from'node:fs/promises';import os from'node:os';import path from'node:path';
import {runWithWorkspaceRoot,type AgentHarness}from'@liminal/core';
import {setPtyShellPort,type PtyManagerPort}from'./pty_shell_port.js';
import {runShellInTerminal,resetTerminalShellRuntimeForTests}from'./terminal_shell_runtime.js';

for(const archiveAvailable of [true,false])test(`completed PowerShell output survives truncation (archive ${archiveAvailable?'available':'unavailable'})`,{skip:process.platform!=='win32'},async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'liminal-output-retention-'));const previous=process.env.AGENT_SHELL;process.env.AGENT_SHELL='powershell';
 resetTerminalShellRuntimeForTests();let calls=0;const captured=JSON.stringify({records:Array.from({length:500},(_,i)=>({id:i,label:'fixture-record-'+i}))});
 const port:PtyManagerPort={ensure:async()=>null,write:()=>false,readTail:()=>'',onData:()=>()=>{},isAlive:()=>false,close:()=>false,list:()=>[],runOneshot:async()=>{calls++;return{exitCode:0,output:captured,sessionId:'completed'};}};
 setPtyShellPort(port);
 t.after(async()=>{setPtyShellPort(null);if(previous===undefined)delete process.env.AGENT_SHELL;else process.env.AGENT_SHELL=previous;assert(path.basename(root).startsWith('liminal-output-retention-'));await rm(root,{recursive:true,force:true});});
 if(!archiveAvailable)await writeFile(path.join(root,'.agent_artifacts'),'blocked archive directory');
 const result=await runWithWorkspaceRoot(root,()=>runShellInTerminal({harness:{taskId:'retention-fixture'}as AgentHarness,command:'fixture',timeoutMs:1000,cappedNote:''}));
 assert(result.ok);assert.equal(calls,1,'never repeat a completed command to repair output capture');
 if(archiveAvailable){const hash=result.output.match(/read_artifact hash=([a-f0-9]{64})/)?.[1];assert(hash);assert.equal(await readFile(path.join(root,'.agent_artifacts',hash+'.txt'),'utf8'),captured);assert.doesNotMatch(result.output,/Terminal panel/);}
 else{assert(result.output.includes(captured));assert.match(result.output,/Do not repeat the command/);}
});
