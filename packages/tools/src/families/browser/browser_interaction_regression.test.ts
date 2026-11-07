import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createServer} from 'node:http';
import {chromium} from 'playwright';
import {selectBrowserOption} from '../../../dist/families/browser/browser_select_option.js';
import {buildPageSnapshot,normalizeOneAction,openBrowserSession,getBrowserSession,snapshotBrowserSession,actOnBrowserSession,shutdownBrowserWorkspace} from '../../../dist/families/browser/browser_runtime.js';
import {ensureBrowserElementRefs} from '../../../dist/families/browser/browser_element_refs.js';

test('custom combobox uses its keyboard UI when a floating label intercepts pointer input', async () => {
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage();
  await page.setContent(`<style>.field{position:relative;width:220px;height:40px}.label{position:absolute;inset:0;z-index:2;background:#eee}</style>
   <select aria-label="Native"><option value="1">January</option><option value="7">July</option></select>
   <div class="field"><div id="month" role="combobox" tabindex="0" aria-label="Month" aria-controls="months" aria-expanded="false">Select month</div><span class="label">Month</span></div>
   <div id="months" role="listbox" hidden><div role="option" data-value="7">July</div></div>
   <script>const month=document.querySelector('#month'),list=document.querySelector('#months');
    month.onkeydown=e=>{if(e.key==='ArrowDown'){list.hidden=false;month.setAttribute('aria-expanded','true')}};
    list.onclick=e=>{month.textContent=e.target.textContent;month.dataset.selected=e.target.dataset.value;list.hidden=true};</script>`);
  const start=Date.now();
  await selectBrowserOption(page,page.getByRole('combobox',{name:'Month',exact:true}),'July',6000);
  assert.ok(Date.now()-start<4000,'must not spend the full 15-second pointer timeout');
  assert.equal(await page.locator('#month').getAttribute('data-selected'),'7');
  await selectBrowserOption(page,page.getByRole('combobox',{name:'Native'}),'July',1000);
  assert.equal(await page.locator('select').inputValue(),'7');
  await assert.rejects(selectBrowserOption(page,page.locator('select'),'Missing',1000),/Option not found/);
  await page.locator('#month').evaluate(el=>el.setAttribute('aria-disabled','true'));
  await assert.rejects(selectBrowserOption(page,page.locator('#month'),'July',1600));
 } finally {await browser.close();}
});

test('attached CDP default contexts register element engines before reference actions',async()=>{
 const profile=await fs.mkdtemp(path.join(os.tmpdir(),'liminal-ref-cdp-'));
 await ensureBrowserElementRefs();
 const owner=await chromium.launchPersistentContext(profile,{headless:true,args:['--remote-debugging-port=0']});
 let attached;
 try {
  const port=Number((await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);
  attached=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  await ensureBrowserElementRefs(true);
  const page=attached.contexts()[0]!.pages()[0]!;
  await page.setContent('<label>Username<input></label><label>Remember<input type="checkbox"></label>');
  const snapshot=await buildPageSnapshot(page);
  const username=[...snapshot.refs.values()].find(r=>r.name==='Username');
  const checkbox=[...snapshot.refs.values()].find(r=>r.name==='Remember');
  assert.ok(username?.selector);assert.ok(checkbox?.selector);
  await page.locator(username.selector).fill('attached-user');
  await page.locator(checkbox.selector).setChecked(true);
  assert.equal(await page.locator('input').first().inputValue(),'attached-user');
  assert.equal(await page.locator('input[type=checkbox]').isChecked(),true);
 } finally {await attached?.close();await owner.close();await fs.rm(profile,{recursive:true,force:true});}
});

test('iframe controls remain actionable without DOM marker attributes, and replaced controls expire',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'liminal-element-refs-'));
 const oldBrowser=process.env.LIMINAL_BROWSER_DATA_DIR;process.env.LIMINAL_BROWSER_DATA_DIR=root;
 const server=createServer((req,res)=>{
  res.setHeader('Content-Type','text/html');
  if(req.url==='/child')res.end(`<label>Username<input id="username"></label><input type="password" aria-label="Password">
   <script>window.markerMutations=0;new MutationObserver(ms=>{for(const m of ms)if(m.type==='attributes'&&m.attributeName.startsWith('data-liminal')){window.markerMutations++;m.target.removeAttribute(m.attributeName)}}).observe(document.body,{subtree:true,attributes:true});</script>`);
  else {const a=server.address();assert.ok(a&&typeof a!=='string');res.end(`<input id="username" aria-label="Hidden mirror" style="visibility:hidden"><iframe src="http://127.0.0.1:${a.port}/child" width="600" height="300"></iframe><div id="closed-host"></div><script>const host=document.querySelector('#closed-host'),root=host.attachShadow({mode:'closed'});root.innerHTML='<input aria-label="Visual entry" style="width:240px;height:40px">';window.fixtureInput=root.querySelector('input');fixtureInput.onclick=e=>window.trustedClick=e.isTrusted;</script>`);}
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const addr=server.address();assert.ok(addr&&typeof addr!=='string');
 try {
  const opened=await openBrowserSession({ownerTaskId:'ref-test',href:`http://localhost:${addr.port}/`,waitUntil:'load',navTimeoutMs:5000,postWaitMs:0,includeConsole:false,includeSnapshot:true});
  assert.ok(opened.ok,opened.ok?'':opened.error);const page=getBrowserSession(opened.sessionId)!.page;
  const frame=page.frames().find(f=>f.url().endsWith('/child'));assert.ok(frame);
  const username=opened.output.match(/\s(e\d+) textbox "Username"/)?.[1];assert.ok(username);
  const password=opened.output.match(/\s(e\d+) textbox "Password"/)?.[1];assert.ok(password);
  const acted=await actOnBrowserSession({sessionId:opened.sessionId,actions:[{op:'fill_ref',ref:username,value:'fixture-user',timeout_ms:1500},{op:'type_ref',ref:password,value:'fixture-secret',delay_ms:0,timeout_ms:1500}],postActionWaitMs:0,refreshSnapshot:true,includeConsole:false});
  assert.ok(acted.ok,acted.ok?'':acted.error);
  assert.equal(await frame.locator('#username').inputValue(),'fixture-user');
  assert.equal(await frame.locator('input[type=password]').inputValue(),'fixture-secret');
  assert.ok(!JSON.stringify(acted).includes('fixture-secret'));
  assert.equal(await frame.evaluate(()=> (window as any).markerMutations),0,'observation must not mutate control attributes');
  const observed=await snapshotBrowserSession(opened.sessionId,false);assert.ok(observed.ok);assert.match(observed.output,new RegExp(username+' textbox "Username"'));
  await frame.locator('#username').evaluate(el=>el.outerHTML='<input id="username" aria-label="Replacement">');
  const stale=await actOnBrowserSession({sessionId:opened.sessionId,actions:[{op:'fill_ref',ref:username,value:'must-not-fill',timeout_ms:500}],postActionWaitMs:0,refreshSnapshot:true,includeConsole:false});
  assert.equal(stale.ok,false);assert.equal(await frame.locator('#username').inputValue(),'');
  const point=await page.evaluate(()=>{const r=(window as any).fixtureInput.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};});
  const visual=await actOnBrowserSession({sessionId:opened.sessionId,actions:[{op:'click_at',...point},{op:'type_text',value:'Visual café 日本語'}],postActionWaitMs:0,refreshSnapshot:true,includeConsole:false});
  assert.ok(visual.ok,visual.ok?'':visual.error);
  assert.deepEqual(await page.evaluate(()=>({value:(window as any).fixtureInput.value,trusted:(window as any).trustedClick})),{value:'Visual café 日本語',trusted:true});
  const outside=await actOnBrowserSession({sessionId:opened.sessionId,actions:[{op:'click_at',x:99999,y:0}],postActionWaitMs:0,refreshSnapshot:false,includeConsole:false});
  assert.equal(outside.ok,false);
  assert.ok('error' in normalizeOneAction({op:'click_at',x:NaN,y:0}));
  assert.ok('error' in normalizeOneAction({op:'click_at',x:-1,y:0}));
  assert.ok('error' in normalizeOneAction({op:'type_text'}));
 } finally {
  await shutdownBrowserWorkspace();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));
  if(oldBrowser===undefined)delete process.env.LIMINAL_BROWSER_DATA_DIR;else process.env.LIMINAL_BROWSER_DATA_DIR=oldBrowser;
  await fs.rm(root,{recursive:true,force:true});
 }
});
