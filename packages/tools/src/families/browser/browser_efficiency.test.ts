import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createServer} from 'node:http';
import {pageExtractedItems,pageExtractedText} from './browser_extraction.js';
import {browserDeadline} from './browser_deadline.js';
import {buildPageSnapshot,openBrowserSession,getBrowserSession,shutdownBrowserWorkspace} from '../../../dist/families/browser/browser_runtime.js';
import {browserExtractTool,browserActTool,browserNavigateTool} from '../../../dist/families/browser/browser_tools.js';

test('paging measures serialized data, preserves prices and reports item offsets',()=>{
  const result=pageExtractedItems(Array.from({length:12},(_,i)=>({text:`Hotel ${i}: room AUD 539; private bathroom; four nights.`,links:[{ref:`e${i}`,destination:'https://example.test/room'}]})),{maxChars:1000});
  assert.ok(JSON.stringify(result).length<=1000);
  assert.ok(result.items.length>=3);assert.equal(result.offset_unit,'items');assert.ok(result.next_offset);
  const next=pageExtractedItems(Array.from({length:12},(_,i)=>String(i)),{offset:result.next_offset!});
  assert.equal(next.items[0],String(result.next_offset));
  assert.throws(()=>pageExtractedItems(['match'],{offset:140}),/item indexes, not character offsets/);
  const clipped=pageExtractedItems([{text:'Long content with escapes "\\\n'.repeat(500),links:[{ref:'e1'}]}],{maxChars:500});
  assert.ok(JSON.stringify(clipped).length<=500);assert.deepEqual(clipped.truncated_items,[0]);
});

test('stalled page observations return a warning promptly instead of stale refs',async()=>{
  const page={url:()=> 'https://example.test/stalled',locator:()=>({evaluateAll:()=>new Promise(()=>{})})};
  const started=Date.now();const result=await buildPageSnapshot(page as never,8000,40);
  assert.ok(Date.now()-started<1000);assert.match(result.snapshotText,/OBSERVATION_WARNING.*timed out/);assert.equal(result.refs.size,0);
  await assert.rejects(browserDeadline(()=>new Promise(()=>{}),30,'Navigation fixture'),/Navigation fixture timed out/);
});

test('text windows honor serialized budgets and can be reconstructed without loss',()=>{
  const value='Quoted "line" with backslash \\ and newline\n'.repeat(80);
  let offset=0,read='';
  while(offset<value.length){
    const page=pageExtractedText(value,{offset,maxChars:500});
    assert.ok(JSON.stringify(page).length<=500);assert.equal(page.offset_unit,'characters');
    read+=page.text;if(page.next_offset===null)break;
    assert.ok(page.next_offset>offset);offset=page.next_offset;
  }
  assert.equal(read,value);
});

test('one listing read returns several complete cards and exact long-link refs',{skip:process.env.AGENT_BROWSER_INTEGRATION!=='1'},async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'liminal-efficient-browser-'));
  const prior={profile:process.env.LIMINAL_BROWSER_DATA_DIR,workspace:process.env.AGENT_WORKSPACE_ROOT};
  process.env.LIMINAL_BROWSER_DATA_DIR=path.join(root,'profile');process.env.AGENT_WORKSPACE_ROOT=root;
  const long='x'.repeat(3200);
  const server=createServer((req,res)=>{
    res.setHeader('Content-Type','text/html; charset=utf-8');
    if(req.url?.startsWith('/rates')){
      res.end(`<article hidden>HIDDEN_RATE_ARTICLE</article><main><h1>Rate details</h1><h2>Availability</h2>
      <div style="opacity:0"><span>HIDDEN_RATE_VALUE</span></div>
      <table><caption>Room plans</caption><thead><tr><th rowspan="2">Room</th><th colspan="2">Rate</th><th rowspan="2">Cancellation</th><th rowspan="2">Quantity</th></tr><tr><th>Previous</th><th>Current members price</th></tr></thead>
      <tbody><tr><td rowspan="2">Modern Standard Double Room – Non‑Smoking; private bathroom</td><td><span style="text-decoration:line-through">AUD 1000</span></td><td><span aria-hidden="true">AUD 800</span></td><td>Free<br>cancellation&nbsp;before 16 March</td><td><select><option>0</option><option>1 (AUD 800)</option><option>2 (AUD 1600)</option></select></td></tr>
      <tr><td><s>AUD 1200</s></td><td>AUD 900</td><td>Non-refundable</td><td><select><option>0</option><option>1 (AUD 900)</option><option>3 (AUD 2700)</option></select></td></tr>
      <tr><td>Smoking Single</td><td>AUD 400</td><td>AUD 300</td><td>Non-refundable</td><td>0</td></tr></tbody></table></main>`);return;
    }
    if(req.url?.startsWith('/room/')){res.end('<title>Selected exact room</title><main><h1>ROOM_DETAIL_EVIDENCE</h1><p>'+('Exact dated destination and room details. '.repeat(60))+'</p><section>'+[1,2].map(i=>'<article><h3><a href="/related/'+i+'">Similar hotel '+i+'</a></h3><p>'+('Related listing summary. '.repeat(6))+'</p></article>').join('')+'</section></main>');return;}
    res.end('<title>Hotel comparison fixture</title><main><aside>'+Array.from({length:65},(_,i)=>`<label>Filter ${i}<input type="checkbox"></label>`).join('')+'</aside>'+[1,2,3,4].map(i=>`<div role="listitem" class="card"><h3><a href="/room/${i}?checkin=2027-03-17&amp;token=${long}">Hotel ${i}</a></h3><p>Private twin room. AUD ${500+i} total for 17–21 March 2027. Free cancellation.</p><ul><li>WiFi included</li></ul>${Array.from({length:5},()=>`<a href="/room/${i}?checkin=2027-03-17&amp;token=${long}">Hotel ${i}</a>`).join('')}</div>`).join('')+'</main>');
  });
  try{
    await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const addr=server.address();assert.ok(addr&&typeof addr==='object');
    const url=`http://127.0.0.1:${addr.port}/`;
    const opened=await openBrowserSession({ownerTaskId:'efficiency-fixture',href:url,waitUntil:'load',navTimeoutMs:5000,postWaitMs:0,includeConsole:false,includeSnapshot:true});
    assert.ok(opened.ok,opened.ok?'':opened.error);assert.match(opened.output,/RESULT_ITEMS/);assert.match(opened.output,/AUD 504/);assert.match(opened.output,/e\d+ link "Hotel 4"/);
    const id=opened.sessionId,owner={taskId:'efficiency-fixture'} as never;
    const result=await browserExtractTool.handler({session_id:id,type:'selector_text',selector:'.card',max_chars:3000,expected_url:url},undefined,owner);
    assert.ok(result.ok,result.ok?'':result.error);const read=JSON.parse(result.output);
    assert.equal(read.data.items.length,4);assert.ok(JSON.stringify(read.data).length<=3000);assert.ok(result.output.length<3500);
    for(const [index,item] of read.data.items.entries()){assert.match(item.text,new RegExp('AUD '+(501+index)));assert.equal(item.links.length,1);assert.match(item.links[0].ref,/^e\d+$/);assert.equal(item.links[0].href,undefined);}
    assert.notEqual(read.data.items[0].links[0].ref,read.data.items[1].links[0].ref);
    const saved=JSON.parse(await fs.readFile(path.join(root,read.checkpoint),'utf8'));assert.equal(saved.observations[0].data.items.length,4);
    // A same-document re-render replaces the node but keeps its observed URL.
    const page=getBrowserSession(id)!.page;
    await page.locator('.card').nth(1).locator('a').evaluateAll(links=>{for(const a of links){const copy=a.cloneNode(true) as Element;copy.removeAttribute('data-liminal-ref');a.replaceWith(copy);}});
    const clicked=await browserActTool.handler({session_id:id,actions:[{op:'click_ref',ref:read.data.items[1].links[0].ref}],wait_ms:0},undefined,owner);assert.ok(clicked.ok,clicked.ok?'':clicked.error);
    assert.equal(new URL(page.url()).pathname,'/room/2');assert.equal(new URL(page.url()).searchParams.get('token'),long);
    const changed=await browserExtractTool.handler({session_id:id,type:'text',expected_url:url},undefined,owner);assert.equal(changed.ok,false);if(!changed.ok)assert.match(changed.error,/PAGE_CHANGED/);
    const datedOwner={taskId:'efficiency-fixture',getContext:()=>({getConversationMessages:()=>[{role:'user',content:'Compare hotels 17–21 March 2027.'}]})} as never;
    const repaired=await browserNavigateTool.handler({session_id:'main',url:url+'?checkin=2026-12-20&checkout=2026-12-24'},undefined,datedOwner);
    assert.ok(repaired.ok,repaired.ok?'':repaired.error);assert.match(repaired.output,/NAVIGATION_CONTEXT_APPLIED/);assert.equal(new URL(page.url()).searchParams.get('checkout'),'2027-03-21');
    const refreshed=await browserExtractTool.handler({session_id:'current',type:'selector_text',selector:'.card'},undefined,datedOwner);assert.ok(refreshed.ok);
    const third=JSON.parse(refreshed.output).data.items[2].links[0].ref;
    const fromRef=await browserNavigateTool.handler({session_id:'invented-tab-123',ref:third},undefined,datedOwner);
    assert.ok(fromRef.ok,fromRef.ok?'':fromRef.error);assert.equal(new URL(page.url()).pathname,'/room/3');assert.equal(new URL(page.url()).searchParams.get('token'),long);assert.equal(new URL(page.url()).searchParams.get('checkout'),'2027-03-21');
    assert.match(fromRef.output,/ROOM_DETAIL_EVIDENCE/);assert.doesNotMatch(fromRef.output,/RESULT_ITEMS:/);
    const canonicalRead=await browserExtractTool.handler({session_id:'current',type:'text',expected_url:url+'room/3'},undefined,datedOwner);assert.ok(canonicalRead.ok,canonicalRead.ok?'':canonicalRead.error);
    const stranger=await browserNavigateTool.handler({session_id:id,ref:third},undefined,{taskId:'foreign-task'} as never);assert.equal(stranger.ok,false);
    const rates=await browserNavigateTool.handler({url:url+'rates'},undefined,owner);assert.ok(rates.ok);
    assert.doesNotMatch(rates.output.split('READABLE_CONTENT:')[1]??'',/AUD 1600|AUD 2700|HIDDEN_RATE/);
    assert.doesNotMatch(rates.output,/combobox "0 1/);
    const matched=await browserExtractTool.handler({type:'text',query:'free cancellation',max_chars:3000},undefined,owner);assert.ok(matched.ok);
    const passage=JSON.parse(matched.output).data.items[0];assert.match(passage.nearbyText,/AUD 800/);assert.match(passage.nearbyText,/Modern Standard Double/);assert.doesNotMatch(passage.nearbyText,/AUD 1600/);
    const plans=await browserExtractTool.handler({type:'tables',query:'non smoking',max_chars:3000},undefined,owner);assert.ok(plans.ok);
    const table=JSON.parse(plans.output).data;
    assert.equal(table.items.length,2);assert.ok(JSON.stringify(table).length<=3000);
    assert.match(table.items[0].text,/Current members price: AUD 800/);assert.match(table.items[1].text,/Room: Modern Standard Double/);assert.match(table.items[1].text,/Current members price: AUD 900/);
    assert.match(table.items[0].text,/\[struck through\]/);assert.doesNotMatch(JSON.stringify(table),/AUD 1600|AUD 2700|Smoking Single/);
    const section=await browserExtractTool.handler({type:'text',query:'Availability',max_chars:3000},undefined,owner);assert.ok(section.ok);assert.doesNotMatch(section.output,/HIDDEN_RATE|AUD 1600|AUD 2700/);
    const raw=await browserExtractTool.handler({type:'text',max_chars:500},undefined,owner);assert.ok(raw.ok);assert.ok(JSON.stringify(JSON.parse(raw.output).data).length<=500);
    const reordered=await browserExtractTool.handler({type:'text',query:'Non-Smoking Standard Double'},undefined,owner);assert.ok(reordered.ok);
    const hit=JSON.parse(reordered.output).data.items[0];assert.equal(hit.match_kind,'all_terms');assert.match(hit.text,/Modern Standard Double/);assert.match(hit.nearbyText,/AUD 800/);
    const reorderedTable=await browserExtractTool.handler({type:'tables',query:'Non-Smoking Standard Double'},undefined,owner);assert.ok(reorderedTable.ok);
    const tableHits=JSON.parse(reorderedTable.output).data.items;assert.equal(tableHits.length,2);assert.ok(tableHits.every((row:{match_kind:string})=>row.match_kind==='all_terms'));
    const unrelated=await browserExtractTool.handler({type:'text',query:'Smoking Single AUD 900'},undefined,owner);assert.ok(unrelated.ok);assert.deepEqual(JSON.parse(unrelated.output).data.matches,[]);
    const unrelatedColumns=await browserExtractTool.handler({type:'text',query:'Non-Smoking Single'},undefined,owner);assert.ok(unrelatedColumns.ok);assert.deepEqual(JSON.parse(unrelatedColumns.output).data.matches,[]);
  }finally{
    await shutdownBrowserWorkspace();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));
    if(prior.profile===undefined)delete process.env.LIMINAL_BROWSER_DATA_DIR;else process.env.LIMINAL_BROWSER_DATA_DIR=prior.profile;
    if(prior.workspace===undefined)delete process.env.AGENT_WORKSPACE_ROOT;else process.env.AGENT_WORKSPACE_ROOT=prior.workspace;
    await fs.rm(root,{recursive:true,force:true});
  }
});
