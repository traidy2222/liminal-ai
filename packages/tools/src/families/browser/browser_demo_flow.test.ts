import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createServer} from 'node:http';
import {normalizeOneAction,openBrowserSession,getBrowserSession,browserWorkspaceState,buildPageSnapshot,shutdownBrowserWorkspace,registerBrowserTurnCleanup,actOnBrowserSession,applyScreencastFrame,snapshotBrowserSession} from '../../../dist/families/browser/browser_runtime.js';
import {browserActTool} from '../../../dist/families/browser/browser_tools.js';
import {withBrowserTask} from '../../../dist/families/browser/browser_queue.js';

test('compact keyboard shortcuts and short pointer holds normalize without losing bounds',()=>{
 for(const [key,expected] of [['ControlEnd','Control+End'],['CtrlHome','Control+Home'],['CmdA','Meta+A'],['End','End'],['Shift+Enter','Shift+Enter']]){
  const result=normalizeOneAction({op:'press_key',key});assert.ok('op' in result);assert.equal(result.op.op,'press_key');if(result.op.op==='press_key')assert.equal(result.op.key,expected);
 }
 assert.ok('op' in normalizeOneAction({op:'press_and_hold_ref',ref:'e1',duration_ms:100}));
 assert.ok('error' in normalizeOneAction({op:'press_and_hold_ref',ref:'e1',duration_ms:99}));
});

test('capacity pressure suspends only safe inactive tabs of the current queued task; overlays retain editor refs',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'liminal-flow-regression-'));
 const prior={data:process.env.LIMINAL_BROWSER_DATA_DIR,live:process.env.AGENT_BROWSER_MAX_LIVE_TABS,max:process.env.AGENT_BROWSER_MAX_SESSIONS};
 process.env.LIMINAL_BROWSER_DATA_DIR=root;process.env.AGENT_BROWSER_MAX_LIVE_TABS='2';process.env.AGENT_BROWSER_MAX_SESSIONS='6';
 const server=createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<title>Safe reference</title><label>Draft<input id="draft"></label>');});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address();assert.ok(address&&typeof address!=='string');const url=`http://127.0.0.1:${address.port}`;
 const open=()=>openBrowserSession({ownerTaskId:'flow',href:url,waitUntil:'load',navTimeoutMs:5000,postWaitMs:0,includeConsole:false,includeSnapshot:false});
 try{
  registerBrowserTurnCleanup({taskId:'flow',getIsRunning:()=>true});
  await withBrowserTask('flow',async()=>{
   const a=await open(),b=await open();assert.ok(a.ok&&b.ok);
   await getBrowserSession(a.sessionId)!.page.evaluate(()=>{document.cookie='demo=retained; path=/';});
   const third=await open();assert.ok(third.ok,third.ok?'':third.error);
   assert.equal(browserWorkspaceState('flow').tabs.find(t=>t.sessionId===a.sessionId)?.suspended,true);
   assert.ok(getBrowserSession(b.sessionId),'current tab was preserved');
   assert.equal(browserWorkspaceState().liveTabCount,2);
   await getBrowserSession(b.sessionId)!.page.locator('#draft').fill('unsaved draft');
   const blocked=await open();assert.equal(blocked.ok,false,'dirty background and current tab both stay pinned');
   const page=getBrowserSession(third.sessionId)!.page;
   await page.setContent(`<main>${Array.from({length:95},(_,i)=>`<button>Background ${i}</button>`).join('')}</main><div style="position:fixed;inset:0;background:white;z-index:10"><div role="button" aria-label="Edit description" style="margin:90px;width:400px;height:100px">Saved notes <a href="https://example.org">Source</a></div></div>`);
   const snapshot=await buildPageSnapshot(page);assert.match(snapshot.snapshotText,/viewport_css/);assert.ok([...snapshot.refs.values()].some(r=>r.name==='Edit description'),'active rich description is in bounded refs despite covered background controls');
   await page.setContent('<div class="outline-row"><div contenteditable="true">Harbour Launch</div><div class="children"><div class="outline-row"><div contenteditable="plaintext-only">Landing page</div><div class="children"><div class="outline-row"><div contenteditable="true">Mobile layout</div></div><div class="outline-row"><div contenteditable="true">Working signup</div></div></div></div><div class="outline-row"><div contenteditable="true">Research</div></div></div></div><div class="outline-row"><div contenteditable="true">Another project</div></div>');
   const outline=await buildPageSnapshot(page);assert.match(outline.snapshotText,/editor_path="Harbour Launch > Landing page"/);assert.match(outline.snapshotText,/value="Landing page"/);
   await page.setContent('<button onclick="navigator.clipboard.writeText(\'https://example.org/private-fixture\')">Copy link</button>');
   const copyShot=await snapshotBrowserSession(third.sessionId,false);assert.ok(copyShot.ok);const copyRef=copyShot.output.match(/(e\d+) button "Copy link"/)![1]!;
   const copied=await actOnBrowserSession({sessionId:third.sessionId,actions:[{op:'click_ref',ref:copyRef}],postActionWaitMs:0,refreshSnapshot:true,includeConsole:false});assert.ok(copied.ok);assert.match(copied.output,/PAGE_COPY_LINKS: \["https:\/\/example.org\/private-fixture"\]/);
   await page.setContent('<textarea aria-label="Notes">first\nsecond</textarea>');await page.locator('textarea').focus();
   const parsed=normalizeOneAction({op:'press_key',key:'ControlEnd'});assert.ok('op' in parsed);
   const result=await actOnBrowserSession({sessionId:third.sessionId,actions:[parsed.op],postActionWaitMs:0,refreshSnapshot:false,includeConsole:false});assert.ok(result.ok,result.ok?'':result.error);
   assert.equal(await page.locator('textarea').evaluate(el=>(el as HTMLTextAreaElement).selectionStart),12);
   await page.setContent('<button disabled>Pending verification</button>');const disabled=await snapshotBrowserSession(third.sessionId,false);assert.ok(disabled.ok);const disabledRef=disabled.output.match(/(e\d+) button "Pending verification"/)![1]!;
   const started=performance.now();const denied=await actOnBrowserSession({sessionId:third.sessionId,actions:[{op:'click_ref',ref:disabledRef}],postActionWaitMs:0,refreshSnapshot:true,includeConsole:false});assert.equal(denied.ok,false);assert.match(denied.error,/TARGET_DISABLED/);assert.ok(performance.now()-started<2000,'disabled controls fail promptly instead of waiting 15 seconds');
   await page.setContent('<button style="margin:30px" onclick="window.presses=(window.presses||0)+1">No effect</button><button style="margin:30px" onclick="document.body.style.backgroundColor=window.flip?\'red\':\'blue\';window.flip=!window.flip"><i class="icon-add"></i></button><ul><li style="cursor:pointer" onclick="this.textContent=\'Selected menu\'">Custom menu action</li></ul>');
   const controls=await buildPageSnapshot(page);assert.match(controls.snapshotText,/icon_hint=.*icon-add/);assert.ok([...controls.refs.values()].some(r=>r.name==='Custom menu action'));
   const live=await snapshotBrowserSession(third.sessionId,false);assert.ok(live.ok);const ref=live.output.match(/(e\d+) button \"No effect\"/)![1]!;
   const act=()=>actOnBrowserSession({sessionId:third.sessionId,actions:[{op:'click_ref',ref},{op:'wait_ms',ms:1}],postActionWaitMs:0,refreshSnapshot:true,includeConsole:false});
   for(let i=0;i<3;i++){const r=await act();assert.ok(r.ok,r.ok?'':r.error);}
   const stopped=await act();assert.equal(stopped.ok,false);assert.match(stopped.error,/NO_PROGRESS/);assert.equal(await page.evaluate(()=>(window as any).presses),3,'the fourth redundant action never runs');
   // Visual changes are progress even if text and controls stay identical.
   const again=await snapshotBrowserSession(third.sessionId,false);assert.ok(again.ok);const visualRef=again.output.match(/(e\d+) button \"Unlabelled control\"/)![1]!;
   for(let i=0;i<5;i++){
    const changed=await actOnBrowserSession({sessionId:third.sessionId,actions:[{op:'click_ref',ref:visualRef}],postActionWaitMs:0,refreshSnapshot:true,includeConsole:false});assert.ok(changed.ok,changed.ok?'':changed.error);
    applyScreencastFrame(third.sessionId,await page.screenshot({type:'jpeg',quality:65,scale:'css'}));
   }

  });
 }finally{
  await shutdownBrowserWorkspace();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));
  for(const [key,value] of [['LIMINAL_BROWSER_DATA_DIR',prior.data],['AGENT_BROWSER_MAX_LIVE_TABS',prior.live],['AGENT_BROWSER_MAX_SESSIONS',prior.max]])if(value===undefined)delete process.env[key!];else process.env[key!]=value;
  await fs.rm(root,{recursive:true,force:true});
 }
});

test('documented url-only browser_act opens and observes a new tab',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'liminal-url-act-'));const prior=process.env.LIMINAL_BROWSER_DATA_DIR;process.env.LIMINAL_BROWSER_DATA_DIR=root;
 const server=createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<h1>New tab destination</h1>');});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const a=server.address();assert.ok(a&&typeof a!=='string');
 try{
  const result=await browserActTool.handler({url:`http://127.0.0.1:${a.port}`,wait_ms:0});
  assert.ok(result.ok,result.ok?'':result.error);assert.match(result.output,/New tab destination/);assert.equal(browserWorkspaceState('anonymous').tabs.length,1);
 }finally{await shutdownBrowserWorkspace();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));if(prior===undefined)delete process.env.LIMINAL_BROWSER_DATA_DIR;else process.env.LIMINAL_BROWSER_DATA_DIR=prior;await fs.rm(root,{recursive:true,force:true});}
});
