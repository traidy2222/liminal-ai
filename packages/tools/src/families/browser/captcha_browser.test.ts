import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createServer} from 'node:http';
import {ContextManager,ToolRegistry,ToolDispatcher,AgentEmitter,type AgentHarness} from '@liminal/core';
import {captchaSolveTool,captchaInspectTool,captchaDragTool} from '../../../dist/families/browser/captcha_solve.js';
import {openBrowserSession,getBrowserSession,injectCaptchaToken,shutdownBrowserWorkspace,actOnBrowserSession} from '../../../dist/families/browser/browser_runtime.js';

test('drag schema rejects absent puzzle inputs before execution; token schema cannot silently select a drag',async()=>{
 assert.deepEqual(captchaDragTool.parameters.required,['visual_ref','source_region']);
 assert.ok(!captchaSolveTool.parameters.properties!.type.enum!.includes('visual_drag'));
 const registry=new ToolRegistry();let calls=0;
 registry.register({...captchaDragTool,requiresApproval:false,handler:async()=>{calls++;return {ok:true,output:'unexpected'};}});
 const dispatcher=new ToolDispatcher(registry,new AgentEmitter());
 for(const args of [{},{visual_ref:'e1'},{visual_ref:'e1',source_region:{x:0,y:0}}])
  assert.equal((await dispatcher.dispatch('invalid','captcha_drag',JSON.stringify(args))).ok,false);
 assert.equal(calls,0);
});

test('solver uses the current or observed task tab, injects privately, and refuses sibling tabs before spending',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'liminal-captcha-'));
 const before={key:process.env.AGENT_CAPTCHA_KEY,browser:process.env.LIMINAL_BROWSER_DATA_DIR,service:process.env.AGENT_CAPTCHA_SERVICE};
 const original=globalThis.fetch;
 process.env.LIMINAL_BROWSER_DATA_DIR=root;process.env.AGENT_CAPTCHA_KEY='synthetic-captcha-key';process.env.AGENT_CAPTCHA_SERVICE='2captcha';
 const server=createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<div class="g-recaptcha" data-callback="onSolved" style="width:300px;height:70px" data-sitekey="fixture-site-key"><input type="checkbox" aria-label="verification"></div><textarea name="g-recaptcha-response" hidden></textarea><output id="result">Pending verification</output><script>window.onSolved=()=>document.querySelector(\'#result\').textContent=\'Verification accepted\';</script>');});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const addr=server.address();assert.ok(addr&&typeof addr!=='string');
 try{
  const opened=await openBrowserSession({ownerTaskId:'solver-owner',href:`http://127.0.0.1:${addr.port}/`,waitUntil:'load',navTimeoutMs:5000,postWaitMs:0,includeConsole:false,includeSnapshot:true});
  assert.ok(opened.ok,opened.ok?'':opened.error);
  let requests=0;
  globalThis.fetch=async(input)=>{
   const url=new URL(String(input));assert.equal(url.protocol,'https:');assert.equal(url.hostname,'2captcha.com');requests++;
   return new Response(JSON.stringify({status:1,request:url.pathname==='/in.php'?'fixture-task-id':'private-fixture-token'}));
  };
  const owner={taskId:'solver-owner'} as AgentHarness;
  const absent=await captchaInspectTool.handler({},undefined,owner);assert.ok(absent.ok,absent.ok?'':absent.error);const noCanvas=JSON.parse(absent.output!.split('\n')[0]);assert.equal(noCanvas.status,'supported_widget');assert.equal(noCanvas.challenge_kind,'recaptcha_v2');assert.equal(noCanvas.solver.configured,true);assert.equal(noCanvas.solver.token_solve_available,true);assert.equal(requests,0);
  const solved=await captchaSolveTool.handler({session_id:'current'},undefined,owner);
  assert.ok(solved.ok,solved.ok?'':solved.error);assert.equal(requests,2);
  assert.ok(!JSON.stringify(solved).includes('private-fixture-token'));
  const page=getBrowserSession(opened.sessionId)!.page;
  assert.equal(await page.locator('[name="g-recaptcha-response"]').inputValue(),'private-fixture-token');assert.equal(await page.locator('[name="g-recaptcha-response"]').isVisible(),false);assert.match(solved.output,/CURRENT_PAGE_AFTER_SOLUTION/);assert.match(solved.output,/Verification accepted/);
  // A token callback can enable a form while the provider's visual overlay stays
  // open. Report those independently instead of treating stale graphics as failure.
  await page.setContent('<form><div class="g-recaptcha" data-callback="ready"></div><textarea name="g-recaptcha-response" hidden></textarea><button disabled>Sign up</button></form><div role="dialog">Unchecked challenge overlay</div><script>window.ready=()=>document.querySelector("button").disabled=false;document.onkeydown=e=>{if(e.key==="Escape")document.querySelector("[role=dialog]")?.remove()};document.querySelector("form").onsubmit=e=>{e.preventDefault();document.body.innerHTML="<h1>Account created</h1>"}</script>');
  const ready=await injectCaptchaToken(opened.sessionId,'recaptcha_v2','private-fixture-token');assert.ok(ready.ok);assert.match(ready.output,/solution_applied_pending_submission/);assert.match(ready.output,/"enabled_submit_controls":\["Sign up"\]/);assert.match(ready.output,/"site_acceptance":"not_observed"/);assert.equal(await page.locator('[role=dialog]').count(),1);
  const reinspection=await captchaInspectTool.handler({},undefined,owner);assert.ok(reinspection.ok);const current=JSON.parse(reinspection.output!.split('\n')[0]);assert.equal(current.submission.response_present,true);assert.deepEqual(current.submission.enabled_submit_controls,['Sign up']);assert.match(current.next,/before paying/);assert.equal(requests,2);assert.ok(!reinspection.output!.includes('private-fixture-token'));
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'Sign up'}).click();assert.equal(await page.locator('h1').innerText(),'Account created');
  await page.setContent('<div class="g-recaptcha" style="width:300px;height:70px" data-sitekey="fixture-site-key"></div>');
  const short='tab-'+opened.sessionId.replace(/[^a-z0-9]/gi,'').slice(0,8);
  const sibling=await captchaSolveTool.handler({session_id:short},undefined,{taskId:'other-owner'} as AgentHarness);
  assert.equal(sibling.ok,false);assert.equal(requests,2);
  await page.locator('.g-recaptcha').evaluate(el=>el.setAttribute('hidden',''));
  const passive=await captchaSolveTool.handler({},undefined,owner);
  assert.equal(passive.ok,false);assert.match(JSON.stringify(passive),/background/);assert.equal(requests,2);
  await page.setContent('<div role="dialog"><h1>Human verification</h1><canvas width="320" height="160"></canvas></div>');
  const visual=await captchaSolveTool.handler({},undefined,owner);assert.equal(visual.ok,false);assert.match(JSON.stringify(visual),/VISIBLE_VISUAL_CHALLENGE/);assert.equal(requests,2);
  globalThis.fetch=async(input,init)=>{requests++;const url=String(input),body=JSON.parse(String(init?.body));assert.ok(url.startsWith('https://api.2captcha.com/'));assert.equal(body.clientKey,'synthetic-captcha-key');
   return new Response(JSON.stringify(url.endsWith('createTask')?{errorId:0,taskId:123}:{errorId:0,status:'ready',solution:{coordinates:[{x:20,y:30},{x:100,y:80}]},cost:'0.0012'}));};
  const coordinateArgs={type:'coordinates',region:{x:10,y:10,width:300,height:150},instructions:'First mark source, then matching destination',min_clicks:2,max_clicks:2};
  const coordinates=await captchaSolveTool.handler(coordinateArgs,undefined,owner);assert.ok(coordinates.ok,coordinates.ok?'':coordinates.error);assert.equal(requests,4);
  const data=JSON.parse(coordinates.output!);assert.deepEqual(data.points,[{x:30,y:40},{x:110,y:90}]);assert.equal(data.verification_state,'not_applied');assert.equal('site_accepted' in data,false);assert.ok(!coordinates.output!.includes('synthetic-captcha-key'));assert.ok(!coordinates.output!.includes('base64'));
  globalThis.fetch=async input=>{requests++;if(String(input).endsWith('getTaskResult'))await page.locator('canvas').evaluate(el=>{const c=el as HTMLCanvasElement;c.getContext('2d')!.fillRect(0,0,100,100);});return new Response(JSON.stringify(String(input).endsWith('createTask')?{errorId:0,taskId:124}:{errorId:0,status:'ready',solution:{coordinates:[{x:20,y:30},{x:100,y:80}]}}));};
  const stale=await captchaSolveTool.handler(coordinateArgs,undefined,owner);assert.equal(stale.ok,false);assert.match(JSON.stringify(stale),/VISUAL_CHALLENGE_CHANGED/);
  const ctx=new ContextManager({inceptionMessages:[],modelMaxTokens:100000,thresholdFraction:.95});
  const visualOwner={taskId:'solver-owner',config:{model:'deepseek/deepseek-v4.1-flash-1017',baseURL:'http://127.0.0.1:1'},getContext:()=>ctx} as AgentHarness;
  const beforeInspect=requests;const inspected=await captchaInspectTool.handler({},undefined,visualOwner);assert.ok(inspected.ok,inspected.ok?'':inspected.error);assert.equal(requests,beforeInspect);
  const info=JSON.parse(inspected.output!.split('\n')[0]);assert.equal(info.visual_targets.length,1);assert.match(info.focused_ref,/^e\d+$/);assert.equal(info.visual_targets[0].width,320);assert.equal(info.visual_targets[0].height,160);
  assert.equal(info.challenge_kind,'unclassified');
  const unknown=await captchaInspectTool.handler({visual_ref:'e999999'},undefined,visualOwner);assert.equal(unknown.ok,false);assert.match(JSON.stringify(unknown),/Unknown visual ref/);assert.equal(requests,beforeInspect);
  const image=(await ctx.buildMessages()).find(m=>Array.isArray(m.content));assert.ok(image);assert.match(JSON.stringify(image.content),/Focused canvas/);assert.match(JSON.stringify(image.content),/THIS image/);
  // The gesture returns a pending result with usable current refs. Submission,
  // rather than another solve of the moved piece, advances the actual fixture.
  await page.setContent('<h1>Human verification</h1><canvas width="320" height="160"></canvas><button disabled>Next</button><script>document.querySelector("canvas").onpointerup=()=>document.querySelector("button").disabled=false;document.querySelector("button").onclick=()=>document.body.innerHTML="<h1>Verified</h1>";</script>');
  const focused=await captchaInspectTool.handler({},undefined,visualOwner);assert.ok(focused.ok,focused.ok?'':focused.error);
  const focus=JSON.parse(focused.output!.split('\n')[0]);
  globalThis.fetch=async input=>{requests++;return new Response(JSON.stringify(String(input).endsWith('createTask')?{errorId:0,taskId:125}:{errorId:0,status:'ready',solution:{coordinates:[{x:200,y:100}]}}));};
  const drag=await captchaDragTool.handler({visual_ref:focus.focused_ref,source_region:{x:0,y:0,width:40,height:40}},undefined,visualOwner);
  assert.ok(drag.ok,drag.ok?'':drag.error);const dragged=JSON.parse(drag.output!.split('\n')[0]);assert.equal(dragged.verification_state,'pending_submission');assert.equal('site_accepted' in dragged,false);
  const nextRef=drag.output!.match(/\[(e\d+)\][^\n]*Next/)?.[1]??drag.output!.match(/(e\d+)[^\n]*button[^\n]*Next/)?.[1];assert.ok(nextRef,drag.output);
  const submitted=await actOnBrowserSession({sessionId:opened.sessionId,actions:[{op:'click_ref',ref:nextRef}],postActionWaitMs:0,refreshSnapshot:true,includeConsole:false});
  assert.ok(submitted.ok,submitted.ok?'':submitted.error);assert.equal(await page.locator('h1').innerText(),'Verified');
  await page.setContent('<h1>Changed page</h1>');const missing=await injectCaptchaToken(opened.sessionId,'recaptcha_v2','private-fixture-token');assert.equal(missing.ok,false);assert.match(missing.error!,/Nothing was applied/);
 }finally{
  globalThis.fetch=original;await shutdownBrowserWorkspace();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));
  for(const [name,value] of Object.entries({AGENT_CAPTCHA_KEY:before.key,LIMINAL_BROWSER_DATA_DIR:before.browser,AGENT_CAPTCHA_SERVICE:before.service}))if(value===undefined)delete process.env[name];else process.env[name]=value;
  await fs.rm(root,{recursive:true,force:true});
 }
});
