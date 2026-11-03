import test from 'node:test';
import assert from 'node:assert/strict';
import type { AgentHarness } from '@liminal/core';
import { PtyManager } from './pty_manager.js';
import { createPtyShellPort } from './pty_shell_port.js';
import {setPtyShellPort} from '../../tools/src/families/shell/pty_shell_port.js';
import {runShellInTerminal,resetTerminalShellRuntimeForTests} from '../../tools/src/families/shell/terminal_shell_runtime.js';
import {setTerminalViewPublisher,type TerminalViewPayload}from'../../tools/src/families/shell/terminal_runtime.js';

test('PowerShell foreground commands return their own output and actual failure status', {skip:process.platform!=='win32'}, async t=>{
  const previous=process.env.AGENT_SHELL;process.env.AGENT_SHELL='powershell';
  const mgr=new PtyManager();const root=process.cwd();
  const port=createPtyShellPort(mgr,async opts=>{const s=mgr.open({...opts,workspaceRoot:root});return{sessionId:s.sessionId,label:s.label,cwd:s.cwd};},()=>root);
  setPtyShellPort(port);resetTerminalShellRuntimeForTests();
  const views:TerminalViewPayload[]=[];const detach=setTerminalViewPublisher(view=>views.push(view));
  t.after(()=>{detach();setPtyShellPort(null);mgr.disposeAll();if(previous===undefined)delete process.env.AGENT_SHELL;else process.env.AGENT_SHELL=previous;});
  const harness={taskId:'owned-foreground-regression'} as AgentHarness;
  async function run(command:string){return runShellInTerminal({harness,command,cwd:root,timeoutMs:15000,cappedNote:''});}
  for(const [command,expected]of [
    ["Write-Output 'FIRST_UNIQUE_A1'",'FIRST_UNIQUE_A1'],
    ['python -c "\nprint(\'MULTILINE_UNIQUE_B2\')\n"','MULTILINE_UNIQUE_B2'],
    ["Write-Output 'LAST_UNIQUE_C3'",'LAST_UNIQUE_C3'],
  ]){const result=await run(command);assert(result.ok,result.ok?undefined:result.error);assert.equal(result.output.trim(),expected);}
  const failure=await run("Write-Output ('diagnostic-' * 30); cmd /c exit 7");
  assert.equal(failure.ok,false,'long diagnostic output must not turn a failed command into success');
  if(!failure.ok){assert.match(failure.error,/Exit code 7/);assert.match(failure.error,/diagnostic-/);}
  const next=await run("Write-Output 'AFTER_FAILURE_D4'");assert(next.ok);assert.equal(next.output.trim(),'AFTER_FAILURE_D4');
  assert.equal(views.length,5,'each live job is surfaced in the desktop/web terminal');
  assert.equal(new Set(views.map(v=>v.sessionId)).size,5);
  assert(views.every(v=>v.chatId===harness.taskId&&v.source==='agent'&&v.open&&v.focus));
});
