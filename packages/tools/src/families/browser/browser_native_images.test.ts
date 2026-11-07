import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {createServer} from 'node:http';
import {AgentHarness} from '@liminal/core';
import {browserOpenTool,browserSnapshotTool,browserActTool} from '../../../dist/families/browser/browser_tools.js';
import {getBrowserSession,browserWorkspaceState,shutdownBrowserWorkspace,getBrowserPanelFrame} from '../../../dist/families/browser/browser_runtime.js';
import {TOOL_FAMILIES} from '../../tool_catalog.js';

test('real browser results feed masked pixels to the next main-model round after all tool results, with no vision call',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'liminal-native-images-'));const previous=process.env.LIMINAL_BROWSER_DATA_DIR;process.env.LIMINAL_BROWSER_DATA_DIR=root;
 const server=createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<h1>Trip booking</h1><p>Room selected</p><label>Password<input type="password" value="first-private-value"></label>');});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const addr=server.address();assert.ok(addr&&typeof addr!=='string');const url=`http://127.0.0.1:${addr.port}/`;
 const h=new AgentHarness({openRouterApiKey:'offline',baseURL:'http://127.0.0.1:1',model:'deepseek/deepseek-v4.1-flash-1017',worldContext:{disabled:true},proceduralMemory:{enabled:false},context:{inceptionMessages:[],modelMaxTokens:100000,thresholdFraction:.95}});
 const state=h as any;let calls=0;
 h.registry.register(browserOpenTool);h.registry.register(browserSnapshotTool);h.registry.register({name:'other_result',description:'Fixture',requiresApproval:false,parameters:{type:'object',properties:{}},handler:async()=>({ok:true,output:'Other result complete'})});
 state.lastUserMessage='Inspect the booking';state.sendStartTime=Date.now();h.getContext().append({role:'user',content:'Inspect the booking'});
 state.streamWithRetry=async(messages:any[])=>{
  calls++;
  if(calls===1)return(async function*(){yield{choices:[{index:0,delta:{tool_calls:[{index:0,id:'open-page',type:'function',function:{name:'browser_open',arguments:JSON.stringify({url,wait_ms:0})}},{index:1,id:'other-result',type:'function',function:{name:'other_result',arguments:'{}'}}]},finish_reason:'tool_calls'}]};})();
  assert.equal(calls,2,'no extra vision or post-completion model calls');
  const image=messages.findIndex(m=>Array.isArray(m.content)&&m.content.some((p:any)=>p.type==='image_url'));
  assert.ok(image>messages.findIndex(m=>m.tool_call_id==='open-page'));
  assert.ok(image>messages.findIndex(m=>m.tool_call_id==='other-result'));
  assert.match(JSON.stringify(messages[image].content[0]),/resulting viewport/);
  return(async function*(){yield{choices:[{index:0,delta:{content:'The room is selected.'},finish_reason:'stop'}]};})();
 };
 try{
  await state.runReActLoop();assert.equal(calls,2);
  const first=(await h.getContext().buildMessages()).find(m=>Array.isArray(m.content))!;
  const page=getBrowserSession(browserWorkspaceState(h.taskId).selectedTabId!)!.page;
  await page.locator('input').evaluate(el=>(el as HTMLInputElement).value='a-different-private-value');
  const refreshed=await browserSnapshotTool.handler({},undefined,h);assert.ok(refreshed.ok);
  const second=(await h.getContext().buildMessages()).find(m=>Array.isArray(m.content))!;
  const pixels=(m:any)=>m.content.find((p:any)=>p.type==='image_url').image_url.url;
  assert.equal(pixels(first),pixels(second),'password values must not change the masked screenshot');
  const id=browserWorkspaceState(h.taskId).selectedTabId!;assert.ok(getBrowserPanelFrame(id));
  const screenshot=page.screenshot.bind(page);page.screenshot=async()=>{throw Error('fixture capture failure');};
  const failed=await browserSnapshotTool.handler({},undefined,h);assert.ok(failed.ok);assert.match(failed.output,/previous image has been removed/);assert.equal(h.getContext().hasImageObservation('browser:'+id),false);assert.equal(getBrowserPanelFrame(id),undefined);
  page.screenshot=screenshot;await browserSnapshotTool.handler({},undefined,h);assert.equal(h.getContext().hasImageObservation('browser:'+id),true);assert.ok(getBrowserPanelFrame(id));
  const other=await browserOpenTool.handler({url:url+'?pane=other',wait_ms:0},undefined,h);assert.ok(other.ok);assert.notEqual(browserWorkspaceState(h.taskId).selectedTabId,id);
  const wrongPoint=await browserActTool.handler({session_id:id,actions:[{op:'click_at',x:99999,y:0}]},undefined,h);assert.equal(wrongPoint.ok,false);assert.equal(browserWorkspaceState(h.taskId).selectedTabId,id,'failed explicit-tab work keeps the screenshot and subsequent actions on the target tab');
  const newest=(await h.getContext().buildMessages()).filter(m=>Array.isArray(m.content)).at(-1)!;assert.ok(!JSON.stringify(newest.content[0]).includes('?pane=other'),'failure image belongs to the operation target');
  assert.ok(!JSON.stringify(h.getContext().getConversationMessages()).includes('data:image/'));
  assert.deepEqual(TOOL_FAMILIES.vision.tools,['upload_image']);assert.equal(h.registry.has('vision_analyze'),false);
 }finally{
  h.closeProcedureRuntime();await shutdownBrowserWorkspace();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));
  if(previous===undefined)delete process.env.LIMINAL_BROWSER_DATA_DIR;else process.env.LIMINAL_BROWSER_DATA_DIR=previous;
  await fs.rm(root,{recursive:true,force:true});
 }
});
