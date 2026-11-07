import test from 'node:test';import assert from 'node:assert/strict';import {chromium} from 'playwright';import {createServer} from 'node:http';
import {embeddedFrameFeedback} from '../../../dist/families/browser/browser_frame_feedback.js';
import {buildPageSnapshot} from '../../../dist/families/browser/browser_runtime.js';
import {BrowserObservations} from './browser_observation.js';

test('embedded accessibility exposes rendered feedback hidden from DOM text and omits hidden content',async()=>{
 const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');if(req.url==='/parent'){const a=server.address();assert.ok(a&&typeof a!=='string');res.end(`<iframe src="http://127.0.0.1:${a.port}/child" width="600" height="300"></iframe>`);return;}res.end('<h1>Preview</h1><div id="host"></div><script>const root=document.querySelector("#host").attachShadow({mode:"closed"});root.innerHTML="<p>Continue with the next step.</p><p hidden>Hidden secret text</p>";window.updateFeedback=text=>root.querySelector("p").textContent=text;</script>');});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const addr=server.address();assert.ok(addr&&typeof addr!=='string');
 const browser=await chromium.launch({headless:true,args:['--site-per-process']});
 try{
  const page=await browser.newPage();await page.goto(`http://localhost:${addr.port}/parent`);
  const frame=page.frames().find(f=>f.url().endsWith('/child'));assert.ok(frame);
  assert.ok(!(await frame.locator('body').innerText()).includes('Continue with'));
  const feedback=await embeddedFrameFeedback(page,frame,'Preview');
  assert.match(feedback,/Continue with the next step/);assert.doesNotMatch(feedback,/Hidden secret/);
  assert.equal(await embeddedFrameFeedback(page,frame,'Preview Continue with the next step.'),'');
  assert.ok((await embeddedFrameFeedback(page,frame,'',12)).length<=12);
  const first=await buildPageSnapshot(page);assert.match(first.snapshotText,/Continue with the next step/);
  const observations=new BrowserObservations();observations.format(page.url(),first.snapshotText);
  await frame.evaluate(()=> (window as any).updateFeedback('Step two is ready.'));
  const second=await buildPageSnapshot(page);const delta=observations.format(page.url(),second.snapshotText);
  assert.match(delta,/Step two is ready/);assert.match(delta,/CONTENT_CHANGE|PAGE_CONTEXT/);
 }finally{await browser.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
