import test from 'node:test';import assert from 'node:assert/strict';import {chromium} from 'playwright';import {createServer} from 'node:http';
import {browserScreenshotPrivacyStyle} from '../../../dist/families/browser/browser_screenshot_privacy.js';
import {dragBrowserPointer} from '../../../dist/families/browser/browser_drag.js';
import {normalizeOneAction} from '../../../dist/families/browser/browser_runtime.js';
import {solveCoordinateImage,captureCaptchaRegion} from '../../../dist/families/browser/captcha_coordinates.js';
import {solveVisualDrag} from '../../../dist/families/browser/captcha_visual_drag.js';

test('password redaction hides revealed text without painting over a foreground verification dialog',async()=>{
 const browser=await chromium.launch({headless:true});
 try{const page=await browser.newPage({viewport:{width:600,height:400}});
  await page.setContent('<style>body{margin:0;background:white}input{position:absolute;left:30px;top:40px;width:240px;height:45px;font:24px monospace;color:black}</style><input autocomplete="new-password" value="visible-first-secret">');
  const first=await page.screenshot({style:browserScreenshotPrivacyStyle});
  await page.locator('input').evaluate(el=>(el as HTMLInputElement).value='a-different-secret');
  const second=await page.screenshot({style:browserScreenshotPrivacyStyle});assert.deepEqual(first,second,'password content must not change screenshot pixels');
  assert.equal(await page.locator('input').inputValue(),'a-different-secret');assert.equal(await page.locator('input').evaluate(el=>getComputedStyle(el).color),'rgb(0, 0, 0)','redaction is screenshot-only');
  await page.evaluate(()=>{const d=document.createElement('div');d.setAttribute('role','dialog');d.style.cssText='position:fixed;inset:0;background:linear-gradient(35deg,#e33,#36e);z-index:100';d.textContent='Human verification: foreground puzzle';document.body.append(d);});
  const visible=await page.screenshot(),redacted=await page.screenshot({style:browserScreenshotPrivacyStyle});assert.deepEqual(redacted,visible,'background password fields must never obscure the foreground puzzle');
 }finally{await browser.close();}
});

test('drag_at delivers trusted sustained pointer movement inside an embedded frame and releases on cancellation',async()=>{
 const server=createServer((req,res)=>{res.setHeader('content-type','text/html');const a=server.address();assert.ok(a&&typeof a!=='string');
  res.end(req.url==='/child'?`<style>body{margin:0}canvas{background:#ddd}</style><canvas width="500" height="300"></canvas><script>window.state={pressed:false,trusted:false,aligned:false};const c=document.querySelector('canvas');c.onpointerdown=e=>{state.pressed=true;state.trusted=e.isTrusted;c.setPointerCapture(e.pointerId)};c.onpointerup=e=>{state.pressed=false;state.aligned=Math.abs(e.offsetX-350)<15&&Math.abs(e.offsetY-200)<15};</script>`:`<iframe src="http://127.0.0.1:${a.port}/child" width="600" height="350" style="border:0"></iframe>`);
 });await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const a=server.address();assert.ok(a&&typeof a!=='string');const browser=await chromium.launch({headless:true});
 try{const page=await browser.newPage({viewport:{width:800,height:600}});await page.goto(`http://localhost:${a.port}/`);const frame=page.frames().find(f=>f.url().endsWith('/child'));assert.ok(frame);const box=await page.locator('iframe').boundingBox();assert.ok(box);
  const op={from_x:box.x+50,from_y:box.y+50,to_x:box.x+350,to_y:box.y+200,duration_ms:200};
  assert.ok('op' in normalizeOneAction({op:'drag_at',...op}));assert.ok('error' in normalizeOneAction({op:'drag_at',from_x:NaN}));
  await dragBrowserPointer(page,op);assert.deepEqual(await frame.evaluate(()=>(window as any).state),{pressed:false,trusted:true,aligned:true});
  const controller=new AbortController();setTimeout(()=>controller.abort(),120);await assert.rejects(dragBrowserPointer(page,{...op,duration_ms:2000},controller.signal),{name:'AbortError'});assert.equal(await frame.evaluate(()=>(window as any).state.pressed),false);
  await assert.rejects(dragBrowserPointer(page,{...op,to_y:99999}),/outside|inside/);
 }finally{await browser.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});

test('coordinate task uses documented HTTPS JSON API and ordered points, and redacts provider key errors',async()=>{
 const previous=globalThis.fetch;let calls=0;
 try{globalThis.fetch=async(input,init)=>{calls++;const url=String(input),body=JSON.parse(String(init?.body));assert.equal(body.clientKey,'synthetic-key');assert.ok(url.startsWith('https://api.2captcha.com/'));
   if(url.endsWith('createTask')){assert.equal(body.task.type,'CoordinatesTask');assert.equal(body.task.minClicks,2);assert.equal(body.task.maxClicks,2);return new Response(JSON.stringify({errorId:0,taskId:123}));}
   return new Response(JSON.stringify({errorId:0,status:'ready',solution:{coordinates:[{x:20,y:30},{x:160,y:90}]},cost:'0.0012'}));};
  const solved=await solveCoordinateImage({key:'synthetic-key',body:'synthetic-image',instructions:'First source, then destination',minClicks:2,maxClicks:2,timeoutMs:1000,pollMs:1});assert.equal(calls,2);assert.deepEqual(solved.points,[{x:20,y:30},{x:160,y:90}]);
  globalThis.fetch=async()=>new Response(JSON.stringify({errorId:1,errorCode:'ERROR_ZERO_BALANCE',errorDescription:'synthetic-key'}));
  await assert.rejects(solveCoordinateImage({key:'synthetic-key',body:'fixture',instructions:'target',minClicks:1,maxClicks:1,timeoutMs:1000,pollMs:1}),e=>{assert.ok(e instanceof Error);assert.match(e.message,/ZERO_BALANCE/);assert.ok(!e.message.includes('synthetic-key'));return true;});
 }finally{globalThis.fetch=previous;}
});

test('visual crop coordinates are CSS pixels even on scrolled high-DPI pages',async()=>{
 const browser=await chromium.launch({headless:true});try{const page=await browser.newPage({viewport:{width:600,height:400},deviceScaleFactor:2});await page.setContent('<div style="height:2400px;background:linear-gradient(red,blue)"></div>');await page.evaluate(()=>scrollTo(0,600));
  const image=await captureCaptchaRegion(page,{x:10,y:20,width:200,height:120});assert.deepEqual(image.region,{x:10,y:20,width:200,height:120});assert.ok(image.body.length>100);assert.ok(image.hash.length===64);
  const dimensions=await page.evaluate(async src=>{const im=new Image();im.src='data:image/jpeg;base64,'+src;await im.decode();return {width:im.naturalWidth,height:im.naturalHeight};},image.body);assert.deepEqual(dimensions,{width:200,height:120});
  await assert.rejects(captureCaptchaRegion(page,{x:590,y:20,width:200,height:120}),/outside/);
 }finally{await browser.close();}
});

test('visual drag separates the loose piece from the destination, applies exact coordinates, and rejects a source-point answer',async()=>{
 const browser=await chromium.launch({headless:true}),previous=globalThis.fetch;let calls=0;
 try{const page=await browser.newPage({viewport:{width:700,height:500}});await page.setContent('<style>body{margin:0}canvas{position:absolute;left:100px;top:80px;background:white}</style><canvas width="400" height="250"></canvas><script>window.state={downs:0,hit:false};const c=document.querySelector("canvas"),ctx=c.getContext("2d");ctx.fillRect(10,10,40,40);ctx.strokeRect(180,140,40,40);c.onpointerdown=e=>{state.downs++;state.trusted=e.isTrusted;c.setPointerCapture(e.pointerId)};c.onpointerup=e=>state.hit=Math.abs(e.offsetX-200)<2&&Math.abs(e.offsetY-160)<2;</script>');
  let sourceAnswer=false;
  globalThis.fetch=async(input,init)=>{calls++;const body=JSON.parse(String(init?.body));if(String(input).endsWith('createTask')){assert.ok(body.task.imgInstructions);assert.equal(body.task.minClicks,1);assert.equal(body.task.maxClicks,1);assert.match(body.task.comment,/Do NOT drag/);return new Response(JSON.stringify({errorId:0,taskId:1}));}return new Response(JSON.stringify({errorId:0,status:'ready',solution:{coordinates:[sourceAnswer?{x:30,y:30}:{x:200,y:160}]}}));};
  const request={page,box:{x:100,y:80,width:400,height:250},source:{x:10,y:10,width:40,height:40},key:'synthetic-key',timeoutMs:1000,pollMs:1};
  const result=await solveVisualDrag(request);assert.equal(result.applied,true);assert.equal(result.verification_state,'pending_submission');assert.equal('site_accepted' in result,false);assert.deepEqual(result.action,{op:'drag_at',from_x:130,from_y:110,to_x:300,to_y:240,duration_ms:900});
  assert.deepEqual(await page.evaluate(()=>(window as any).state),{downs:1,hit:true,trusted:true});
  sourceAnswer=true;await assert.rejects(solveVisualDrag(request),/solver marked the loose source piece/);assert.equal(await page.evaluate(()=>(window as any).state.downs),1,'bad answer must not move the piece');
  const before=calls;await assert.rejects(solveVisualDrag({...request,source:{x:500,y:0,width:40,height:40}}),/inside the inspected canvas/);assert.equal(calls,before,'invalid crops never spend credits');
 }finally{globalThis.fetch=previous;await browser.close();}
});
