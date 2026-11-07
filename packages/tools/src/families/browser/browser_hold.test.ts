import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createServer,type Server} from 'node:http';
import {ToolRegistry,ToolDispatcher,AgentEmitter} from '@liminal/core';
import {BROWSER_ACTION_SCHEMA} from './browser_tools.js';
import {normalizeOneAction,openBrowserSession,getBrowserSession,actOnBrowserSession,shutdownBrowserWorkspace} from '../../../dist/families/browser/browser_runtime.js';
import {holdBrowserControl} from '../../../dist/families/browser/browser_hold.js';

test('hold schema and runtime validation reject invalid refs and unbounded durations',async()=>{
 const registry=new ToolRegistry();let calls=0;
 registry.register({name:'hold_fixture',description:'fixture',requiresApproval:false,parameters:{type:'object',properties:{actions:{type:'array',items:BROWSER_ACTION_SCHEMA}},required:['actions']},handler:async()=>{calls++;return {ok:true,output:'ok'};}});
 const dispatcher=new ToolDispatcher(registry,new AgentEmitter());
 for(const action of [{op:'press_and_hold_ref',ref:'e1'},{op:'press_and_hold_ref',ref:'e1',duration_ms:15001},{op:'press_and_hold_ref',ref:'e1',duration_ms:0},{op:'press_and_hold_ref',ref:'e1',duration_ms:500.5}]){
  assert.equal((await dispatcher.dispatch('bad','hold_fixture',JSON.stringify({actions:[action]}))).ok,false);
  assert.ok('error' in normalizeOneAction(action));
 }
 assert.ok('error' in normalizeOneAction({op:'press_and_hold_ref',ref:'#button',duration_ms:500}));
 assert.ok((await dispatcher.dispatch('good','hold_fixture',JSON.stringify({actions:[{op:'press_and_hold_ref',ref:'e1',duration_ms:600}]}))).ok);
 assert.equal(calls,1);
});

test('observed embedded controls receive a trusted sustained hold, and cancellation releases the pointer',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'liminal-hold-'));const previous=process.env.LIMINAL_BROWSER_DATA_DIR;
 process.env.LIMINAL_BROWSER_DATA_DIR=root;
 const listen=async(server:Server)=>{await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const a=server.address();assert.ok(a&&typeof a!=='string');return `http://127.0.0.1:${a.port}`;};
 const child=createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end(`<button id="hold" style="width:220px;height:80px">Hold to preview</button><output id="status">Ready</output><script>
 const button=document.querySelector('#hold');let start=0;window.state={pressed:false,duration:0,trusted:false};
 button.addEventListener('mousedown',e=>{start=performance.now();state.pressed=true;state.trusted=e.isTrusted;});
 document.addEventListener('mouseup',()=>{state.duration=performance.now()-start;state.pressed=false;document.querySelector('#status').textContent=state.duration>=500?'Preview ready':'Hold too short';});
 </script>`);});
 const childUrl=await listen(child);
 const parent=createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end(`<h1>Preview fixture</h1><iframe title="Preview controls" src="${childUrl}" width="500" height="200"></iframe>`);});
 const url=await listen(parent);
 try{
  const opened=await openBrowserSession({ownerTaskId:'hold-fixture',href:url,waitUntil:'load',navTimeoutMs:5000,postWaitMs:0,includeConsole:false,includeSnapshot:true});
  assert.ok(opened.ok,opened.ok?'':opened.error);
  const ref=opened.output.match(/(e\d+) button "Hold to preview"/)?.[1];assert.ok(ref,opened.output);
  const page=getBrowserSession(opened.sessionId)!.page,frame=page.frames().find(f=>f.url().startsWith(childUrl));assert.ok(frame);
  const normal=await actOnBrowserSession({sessionId:opened.sessionId,actions:[{op:'click_ref',ref}],postActionWaitMs:0,refreshSnapshot:true,includeConsole:false});assert.ok(normal.ok);
  assert.equal(await frame.locator('#status').textContent(),'Hold too short');
  const held=await actOnBrowserSession({sessionId:opened.sessionId,actions:[{op:'press_and_hold_ref',ref,duration_ms:600}],postActionWaitMs:0,refreshSnapshot:true,includeConsole:false});
  assert.ok(held.ok,held.ok?'':held.error);assert.match(held.output,/Preview ready/);
  const state=await frame.evaluate(()=> (window as unknown as {state:{duration:number,trusted:boolean,pressed:boolean}}).state);
  assert.ok(state.duration>=500);assert.equal(state.trusted,true);assert.equal(state.pressed,false);
  const controller=new AbortController();
  const cancelled=holdBrowserControl(frame.locator('#hold'),5000,3000,controller.signal).then(()=>null,error=>error);
  await frame.waitForFunction(()=> (window as unknown as {state:{pressed:boolean}}).state.pressed,{},{timeout:3000});
  controller.abort();assert.ok(await cancelled instanceof Error);
  assert.equal(await frame.evaluate(()=> (window as unknown as {state:{pressed:boolean}}).state.pressed),false);
  await frame.locator('#hold').evaluate(el=>el.setAttribute('disabled',''));
  await assert.rejects(holdBrowserControl(frame.locator('#hold'),600,1000),/TARGET_DISABLED/);
 }finally{
  await shutdownBrowserWorkspace();for(const server of [parent,child]){server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
  if(previous===undefined)delete process.env.LIMINAL_BROWSER_DATA_DIR;else process.env.LIMINAL_BROWSER_DATA_DIR=previous;
  await fs.rm(root,{recursive:true,force:true});
 }
});
