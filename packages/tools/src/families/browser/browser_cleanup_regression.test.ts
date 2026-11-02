import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { openBrowserSession, runOneShotBrowserAct, listBrowserSessionIdsForTask } from './browser_runtime.js';
for(const kind of ['session','oneshot'])for(const failure of ['context','page','navigation','title'])test(`${kind} closes its browser after ${failure} failure`,async(t)=>{
 let closed=0;
 const page={setDefaultTimeout(){},setDefaultNavigationTimeout(){},on(){},goto:async()=>{if(failure==='navigation')throw Error('fixture navigation');},url:()=> 'https://example.invalid',title:async()=>{throw Error('fixture title');},innerText:async()=>{throw Error('fixture text');}};
 const context={addInitScript:async()=>{},newPage:async()=>{if(failure==='page')throw Error('fixture page');return page;},close:async()=>{}};
 t.mock.method(chromium,'launch',async()=>({newContext:async()=>{if(failure==='context')throw Error('fixture context');return context;},close:async()=>{closed++;}} as any));
 const opts={href:'https://example.invalid',waitUntil:'load' as const,navTimeoutMs:100,includeConsole:false};
 if(kind==='session')await openBrowserSession({...opts,ownerTaskId:`cleanup-${failure}`,postWaitMs:0,includeSnapshot:false});
 else await runOneShotBrowserAct({...opts,actions:[],postActionWaitMs:0});
 assert.equal(closed,1,'launched browser must close exactly once');
 if(kind==='session')assert.deepEqual(listBrowserSessionIdsForTask(`cleanup-${failure}`),[]);
});
