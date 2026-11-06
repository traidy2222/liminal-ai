import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {createServer} from "node:http";
// Test the compiled evaluator, matching production rather than tsx's injected __name helper.
import {browserActTool,browserSnapshotTool,browserExtractTool} from "../../../dist/families/browser/browser_tools.js";
import {openBrowserSession,getBrowserSession,snapshotBrowserSession,actOnBrowserSession,extractFromSession,shutdownBrowserWorkspace} from "../../../dist/families/browser/browser_runtime.js";

test("contextual browser: validation, stale refs, frames, shadow DOM, modal priority and partial recovery",{skip:process.env.AGENT_BROWSER_INTEGRATION!=="1"},async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"liminal-browser-context-"));const prior=process.env.LIMINAL_BROWSER_DATA_DIR;process.env.LIMINAL_BROWSER_DATA_DIR=root;
 const server=createServer((req,res)=>{res.setHeader("Content-Type","text/html");if(req.url==='/frame'){res.end('<label>Frame entry<input></label>');return;}
 res.end(`<title>Context fixture</title><nav>${Array.from({length:60},(_,i)=>`<a href="#nav${i}">Navigation ${i}</a>`).join('')}</nav><main>
 <h1>Register your account</h1><p>Released <relative-time datetime="2026-10-14T01:51:00Z">14 Oct 11:51</relative-time></p><p>Asset built <time datetime="2026-10-13T21:18:30Z">13 Oct 21:18</time></p>
 <label id="editable-title" ondblclick="document.querySelector('#title-editor').hidden=false">Draft email</label><input id="title-editor" aria-label="Title editor" hidden><form onsubmit="event.preventDefault();const a=document.querySelector('#address');if(a.value==='taken@example.test'){document.querySelector('#feedback').textContent='That address is already in use. Try a different address.';a.setAttribute('aria-invalid','true')}else{document.querySelector('#feedback').textContent='Account ready';a.removeAttribute('aria-invalid')}">
 <label>Email address<input id="address" required type="email" aria-describedby="feedback"></label><button>Continue</button><div id="feedback" role="alert"></div></form>
 <div aria-hidden="true"><button>Hidden duplicate</button></div><button disabled>Unavailable action</button>
 <ul><li>Pack camera<input aria-label="Toggle task" id="styled-toggle" type="checkbox" style="opacity:0;width:24px;height:24px"></li></ul><div style="opacity:0"><input type="checkbox" aria-label="Hidden toggle"></div>
 <label>Notes<div contenteditable="true" aria-label="Notes" style="min-height:24px" style="min-height:24px"></div></label><div id="shadow"></div><iframe title="Embedded details" src="/frame"></iframe>
 <section><h2>City forecast</h2><p>Mostly sunny</p></section><section><h2>Coastal forecast</h2><p>Last updated <time>4:00 pm</time></p></section><dialog><h2>Confirm action</h2><button onclick="this.closest('dialog').close()">Confirm dialog</button></dialog>
 </main><script>document.querySelector('#shadow').attachShadow({mode:'open'}).innerHTML='<label>Shadow entry<input></label>';</script>`);});
 await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));const addr=server.address();assert.ok(addr&&typeof addr!=="string");
 try{
 const opened=await openBrowserSession({ownerTaskId:"context-test",href:`http://127.0.0.1:${addr.port}/`,waitUntil:"load",navTimeoutMs:5000,postWaitMs:0,includeConsole:false,includeSnapshot:true});assert.ok(opened.ok);const id=opened.sessionId,page=getBrowserSession(id)!.page;
 let snapshot=opened.output;const ref=(name:string)=>{const line=snapshot.split('\n').find(line=>/^\s+e\d+ /.test(line)&&line.includes(`"${name}"`));assert.ok(line,`missing ref for ${name}`);return line.trim().split(' ')[0]!;};
 await t.test('important controls and their state survive a large navigation menu',()=>{assert.ok(ref('Email address'));assert.ok(ref('Notes'));assert.match(snapshot,/Unavailable action.*disabled/);assert.doesNotMatch(snapshot,/e\d+ .*Hidden duplicate/);});
 await t.test('ordinary same-page actions return deltas and opt-out omits duplicated body text',async()=>{
 const delta=await actOnBrowserSession({sessionId:id,actions:[{op:'wait_ms',ms:0}],postActionWaitMs:0,refreshSnapshot:true,includeConsole:false,compactObservation:true});assert.ok(delta.ok);assert.match(delta.output,/OBSERVATION_DELTA/);assert.ok(delta.output.length<opened.output.length/2);
 const minimal=await actOnBrowserSession({sessionId:id,actions:[{op:'wait_ms',ms:0}],postActionWaitMs:0,refreshSnapshot:false,includeConsole:false,compactObservation:true});assert.ok(minimal.ok);assert.match(minimal.output,/OBSERVATION_NOT_REFRESHED/);assert.ok(minimal.output.length<500);
 });
 await t.test('transparent native checkbox hit targets retain row context and verified state',async()=>{
 assert.match(snapshot,/OBSERVED_AT:.*timeZone/);assert.doesNotMatch(snapshot,/e\d+ .*Hidden toggle/);
 const toggle=ref('Toggle task');assert.match(snapshot,/checkbox "Toggle task".*row="Pack camera".*checked=false/);
 for(let i=0;i<2;i++){const result=await browserActTool.handler({full_snapshot:true,session_id:id,actions:[{op:'check_ref',ref:toggle}],wait_ms:0},undefined,{taskId:'context-test'} as never);assert.ok(result.ok,result.ok?'':result.error);snapshot=result.output;assert.match(snapshot,/checkbox "Toggle task".*checked=true/);}
 assert.equal(await page.locator('#styled-toggle').isChecked(),true);
 const reset=await browserActTool.handler({full_snapshot:true,session_id:id,actions:[{op:'uncheck_ref',ref:toggle}],wait_ms:0},undefined,{taskId:'context-test'} as never);assert.ok(reset.ok);snapshot=reset.output;assert.equal(await page.locator('#styled-toggle').isChecked(),false);
 });
 await t.test('omitted session resolves only the one tab owned by this task',async()=>{
 const result=await browserActTool.handler({full_snapshot:true,actions:[{op:'focus_ref',ref:ref('Email address')}],wait_ms:0},undefined,{taskId:'context-test'} as never);assert.ok(result.ok);snapshot=result.output;
 const other=await openBrowserSession({ownerTaskId:'context-test',href:`http://127.0.0.1:${addr.port}/`,waitUntil:'load',navTimeoutMs:5000,postWaitMs:0,includeConsole:false,includeSnapshot:false});assert.ok(other.ok);
 const selected=await browserSnapshotTool.handler({},undefined,{taskId:'context-test'} as never);assert.ok(selected.ok);assert.match(selected.output,new RegExp('SESSION_ID: tab-'+other.sessionId.replace(/[^a-z0-9]/gi,'').slice(0,8)));
 });
 await t.test('short tab handles preserve ownership and unknown IDs return current choices',async()=>{
 const alias='tab-'+id.replace(/[^a-z0-9]/gi,'').slice(0,8);
 const known=await browserActTool.handler({full_snapshot:true,session_id:alias,actions:[{op:'focus_ref',ref:ref('Email address')}]},undefined,{taskId:'context-test'} as never);assert.ok(known.ok);assert.match(known.output,new RegExp('SESSION_ID: '+alias));snapshot=known.output;
 const stranger=await browserActTool.handler({session_id:alias,actions:[{op:'wait_ms',ms:0}]},undefined,{taskId:'other-agent'} as never);assert.equal(stranger.ok,false);
 const unknown=await browserActTool.handler({session_id:'tab-unknown',actions:[{op:'wait_ms',ms:0}]},undefined,{taskId:'context-test'} as never);assert.equal(unknown.ok,false);if(!unknown.ok)assert.ok(unknown.error.includes(alias));
 });
 await t.test('each task keeps its selected tab without passing handles again',async()=>{
 const owner={taskId:'context-test'} as never;
 const selected=await browserSnapshotTool.handler({session_id:id},undefined,owner);assert.ok(selected.ok);snapshot=selected.output;
 const focused=await browserSnapshotTool.handler({},undefined,owner);assert.ok(focused.ok);snapshot=focused.output;assert.ok(focused.output.includes('SESSION_ID: tab-'+id.replace(/[^a-z0-9]/gi,'').slice(0,8)));
 const extracted=await browserExtractTool.handler({type:'forms'},undefined,owner);assert.ok(extracted.ok);
 const rejected=await browserSnapshotTool.handler({session_id:'tab-invalid'},undefined,owner);assert.equal(rejected.ok,false);
 const retained=await browserSnapshotTool.handler({},undefined,owner);assert.ok(retained.ok);snapshot=retained.output;
 });
 await t.test('publication and build timestamps retain their separate semantic context',()=>{
 assert.match(snapshot,/2026-10-14T01:51:00Z/);assert.match(snapshot,/2026-10-13T21:18:30Z/);assert.match(snapshot,/Released/);assert.match(snapshot,/Asset built/);
 });
 await t.test('native double-click opens an inline editor',async()=>{
 const r=await actOnBrowserSession({sessionId:id,actions:[{op:'double_click_ref',ref:ref('Draft email')}],postActionWaitMs:0,refreshSnapshot:true,includeConsole:false});assert.ok(r.ok,r.ok?'':r.error);snapshot=r.output;assert.ok(ref('Title editor'));
 });
 await t.test('feedback explains a rejected value and a different attempt succeeds',async()=>{
 const a=await actOnBrowserSession({sessionId:id,actions:[{op:'fill_ref',ref:ref('Email address'),value:'taken@example.test'},{op:'click_ref',ref:ref('Continue')}],postActionWaitMs:0,refreshSnapshot:true,includeConsole:false});assert.ok(a.ok);snapshot=a.output;assert.match(snapshot,/already in use/);assert.match(snapshot,/Email address.*taken@example.test/);
 const b=await actOnBrowserSession({sessionId:id,actions:[{op:'fill_ref',ref:ref('Email address'),value:'available@example.test'},{op:'click_ref',ref:ref('Continue')}],postActionWaitMs:0,refreshSnapshot:true,includeConsole:false});assert.ok(b.ok);snapshot=b.output;assert.match(snapshot,/Account ready/);
 });
 await t.test('unchanged nodes retain handles; replacements cannot inherit them',async()=>{
 const old=ref('Email address');const fresh=await snapshotBrowserSession(id,false);assert.ok(fresh.ok);snapshot=fresh.output;assert.equal(ref('Email address'),old);
 const repeated=await actOnBrowserSession({sessionId:id,actions:[{op:'focus_ref',ref:old}],postActionWaitMs:0,refreshSnapshot:true,includeConsole:false});assert.ok(repeated.ok);snapshot=repeated.output;assert.equal(ref('Email address'),old);
 await page.locator('#address').evaluate(el=>el.replaceWith(el.cloneNode(true)));
 const next=await snapshotBrowserSession(id,false);assert.ok(next.ok);snapshot=next.output;assert.notEqual(ref('Email address'),old);
 const stale=await actOnBrowserSession({sessionId:id,actions:[{op:'fill_ref',ref:old,value:'wrong'}],postActionWaitMs:0,refreshSnapshot:true,includeConsole:false});assert.equal(stale.ok,false);if(!stale.ok)snapshot=stale.error;
 });
 await t.test('visible frame and open shadow controls can be observed and operated',async()=>{
 const r=await actOnBrowserSession({sessionId:id,actions:[{op:'fill_ref',ref:ref('Shadow entry'),value:'shadow done'},{op:'fill_ref',ref:ref('Frame entry'),value:'frame done'},{op:'fill_ref',ref:ref('Notes'),value:'editable done'}],postActionWaitMs:0,refreshSnapshot:true,includeConsole:false});assert.ok(r.ok,r.ok?'':r.error);snapshot=r.output;
 assert.equal(await page.locator('#shadow input').inputValue(),'shadow done');assert.equal(await page.frameLocator('iframe').getByRole('textbox').inputValue(),'frame done');assert.equal(await page.locator('[contenteditable]').innerText(),'editable done');
 });
 await t.test('form extraction includes standalone, shadow and embedded inputs without changing refs',async()=>{
 const priorRef=ref('Email address');const result=await extractFromSession(id,'forms');assert.ok(result.ok);const groups=JSON.parse(result.output);const fields=groups.flatMap((group:any)=>group.fields);
 assert.ok(fields.some((field:any)=>field.label==='Shadow entry'&&field.value==='shadow done'));
 assert.ok(fields.some((field:any)=>field.label==='Frame entry'&&field.value==='frame done'));
 assert.ok(groups.some((group:any)=>group.unowned));
 const stillCurrent=await actOnBrowserSession({sessionId:id,actions:[{op:'focus_ref',ref:priorRef}],postActionWaitMs:0,refreshSnapshot:true,includeConsole:false});assert.ok(stillCurrent.ok);snapshot=stillCurrent.output;
 });
 await t.test('text extraction keeps headings and scopes repeated metadata to the right section',async()=>{
 const full=await extractFromSession(id,'text');assert.ok(full.ok);assert.match(JSON.parse(full.output),/## Coastal forecast/);
 const matched=await browserExtractTool.handler({session_id:id,type:'text',query:'Last updated'});assert.ok(matched.ok);const rows=JSON.parse(matched.output);assert.ok(rows.length);assert.equal(rows[0].headingPath.at(-1),'Coastal forecast');assert.ok(!rows[0].headingPath.includes('City forecast'));
 const section=await browserExtractTool.handler({session_id:id,type:'text',query:'Coastal forecast'});assert.ok(section.ok);assert.match(JSON.parse(section.output)[0].nearbyText,/Last updated/);
 await page.locator('main').evaluate(el=>el.insertAdjacentHTML('beforeend','<section><h2><span>Detailed evidence</span></h2><p>'+('Extended article text. '.repeat(80))+'Later evidence marker.</p><a href="https://example.com/original">Original statement</a></section>'));
 const detail=await browserExtractTool.handler({session_id:id,type:'text',query:'Detailed evidence'});assert.ok(detail.ok);assert.match(JSON.parse(detail.output)[0].nearbyText,/Later evidence marker/);assert.equal(JSON.parse(detail.output)[0].links[0].href,'https://example.com/original');
 const first=await browserExtractTool.handler({session_id:id,type:'text',max_chars:500});assert.ok(first.ok);const chunk=JSON.parse(first.output);assert.equal(chunk.offset,0);assert.equal(chunk.text.length,500);assert.ok(chunk.next_offset>0);
 const next=await browserExtractTool.handler({session_id:id,type:'text',offset:chunk.next_offset,max_chars:500});assert.ok(next.ok);assert.equal(JSON.parse(next.output).offset,chunk.next_offset);assert.notEqual(JSON.parse(next.output).text,chunk.text);
 const links=await browserExtractTool.handler({session_id:id,type:'links',query:'#nav59'});assert.ok(links.ok);assert.equal(JSON.parse(links.output).total_matches,1);assert.ok(JSON.parse(links.output).links[0].href.endsWith('#nav59'));
 });
 await t.test('recorded findings match the actual page and remain scoped to the owning chat',async()=>{
 const automatic=await browserExtractTool.handler({session_id:id,type:'text',query:'Coastal forecast'},undefined,{taskId:'context-test'} as never);assert.ok(automatic.ok);
 const sourced=JSON.parse(automatic.output);assert.equal(sourced.source.url,page.url());assert.ok(Date.parse(sourced.source.observed_at));assert.equal(sourced.source.kind,'page_observation');assert.match(JSON.stringify(sourced.data),/Coastal forecast/);
 const owner={taskId:'context-test'} as never;
 const recorded=await browserExtractTool.handler({session_id:id,type:'findings',findings:[{statement:'The city forecast says mostly sunny',quote:'Mostly sunny',kind:'observation'}]},undefined,owner);assert.ok(recorded.ok);
 const row=JSON.parse(recorded.output).findings[0];assert.equal(row.url,page.url());assert.equal(row.quote,'Mostly sunny');assert.equal(row.support,'matched_page_text');assert.ok(Date.parse(row.observed_at));
 const unsupported=await browserExtractTool.handler({session_id:id,type:'findings',findings:[{statement:'The product is quieter',quote:'Guaranteed quieter than all competitors'}]},undefined,owner);assert.equal(unsupported.ok,false);
 const listed=await browserExtractTool.handler({type:'findings'},undefined,owner);assert.ok(listed.ok);assert.equal(JSON.parse(listed.output).findings.length,1);
 const other=await browserExtractTool.handler({type:'findings'},undefined,{taskId:'other-agent'} as never);assert.ok(other.ok);assert.equal(JSON.parse(other.output).findings.length,0);
 });
 await t.test('routine observations omit diagnostics and extracted rows retain actual destinations',async()=>{
 const owner={taskId:'context-test'} as never;
 await page.evaluate(()=>{for(let i=0;i<50;i++)console.error('repeated test diagnostic');});
 const normal=await browserSnapshotTool.handler({session_id:id},undefined,owner);assert.ok(normal.ok);assert.doesNotMatch(normal.output,/CONSOLE:/);
 const debug=await browserSnapshotTool.handler({session_id:id,include_console:true},undefined,owner);assert.ok(debug.ok);assert.equal(debug.output.split('ERROR: repeated test diagnostic').length-1,1);
 await page.locator('main').evaluate(el=>el.insertAdjacentHTML('beforeend','<div class="listing"><a href="/product/example-gpu">Example GPU</a><span>Price $2899. In stock.</span></div>'));
 const result=await browserExtractTool.handler({session_id:id,type:'selector_text',selector:'.listing'},undefined,owner);assert.ok(result.ok);
 const row=JSON.parse(result.output);assert.equal(row.source.url,page.url());assert.match(row.data.items[0].text,/Price \$2899/);assert.equal(row.data.items[0].links[0].href,new URL('/product/example-gpu',page.url()).href);
 });
 await t.test('reload performs a real document refresh while retaining saved browser state',async()=>{
 await page.evaluate(()=>{localStorage.setItem('reload-proof','saved');(window as unknown as Record<string,unknown>).reloadMarker='old document';});
 const r=await actOnBrowserSession({sessionId:id,actions:[{op:'reload'}],postActionWaitMs:0,refreshSnapshot:true,includeConsole:false});assert.ok(r.ok,r.ok?'':r.error);snapshot=r.output;
 assert.equal(await page.evaluate(()=>localStorage.getItem('reload-proof')),'saved');assert.equal(await page.evaluate(()=>(window as unknown as Record<string,unknown>).reloadMarker),undefined);
 });
 await t.test('partial action failures report completed steps and current recovery context',async()=>{
 const r=await actOnBrowserSession({sessionId:id,actions:[{op:'fill_ref',ref:ref('Email address'),value:'partial@example.test'},{op:'click_selector',selector:'#does-not-exist',timeout_ms:500}],postActionWaitMs:0,refreshSnapshot:true,includeConsole:false});assert.equal(r.ok,false);if(!r.ok){assert.match(r.error,/completed_steps.*1/);assert.match(r.error,/partial@example.test/);assert.match(r.error,/SNAPSHOT_REFS/);snapshot=r.error;}
 });
 await t.test('a modal becomes the active context instead of buried page controls',async()=>{
 await page.locator('dialog').evaluate((el:HTMLDialogElement)=>el.showModal());const r=await snapshotBrowserSession(id,false);assert.ok(r.ok);snapshot=r.output;assert.ok(ref('Confirm dialog'));assert.doesNotMatch(snapshot,/e\d+ .*"Email address"/);
 });
 }finally{await shutdownBrowserWorkspace();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));if(prior===undefined)delete process.env.LIMINAL_BROWSER_DATA_DIR;else process.env.LIMINAL_BROWSER_DATA_DIR=prior;await fs.rm(root,{recursive:true,force:true});}
});
