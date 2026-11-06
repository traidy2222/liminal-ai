import test from 'node:test';
import assert from 'node:assert/strict';
import {BrowserFindings} from './browser_findings.js';
import {BrowserObservations,formatBrowserSnapshot} from './browser_observation.js';
import {pageExtractedItems} from './browser_extraction.js';
import {withBrowserTask} from './browser_queue.js';

test('concurrent same-chat operations serialize, nested helpers do not deadlock and failures release the queue',async()=>{
 const order:string[]=[];let release!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;});
 const first=withBrowserTask('chat-a',async()=>{order.push('first');await gate;return withBrowserTask('chat-a',async()=>{order.push('nested');});});
 const second=withBrowserTask('chat-a',async()=>{order.push('second');});
 await withBrowserTask('chat-b',async()=>{order.push('other');});
 assert.deepEqual(order,['first','other']);release();await Promise.all([first,second]);assert.deepEqual(order,['first','other','nested','second']);
 await assert.rejects(withBrowserTask('chat-a',async()=>{throw Error('navigation failed');}));
 assert.equal(await withBrowserTask('chat-a',async()=>42),42);
});

test('large control lists retain readable evidence and array extractions are bounded and pageable',()=>{
 const snapshot=formatBrowserSnapshot({observedAt:'now',contexts:['main: normal'],controls:Array.from({length:100},(_,i)=>`  e${i} link "${'navigation'.repeat(30)}"`),readable:'Price $2899. In stock. '+ 'evidence '.repeat(800),tree:''});
 assert.ok(snapshot.length<=8000);assert.match(snapshot,/READABLE_CONTENT:\nPrice \$2899\. In stock/);assert.match(snapshot,/controls omitted/);assert.match(snapshot,/text truncated/);
 const entries=['alpha '.repeat(60),'alpha '.repeat(60),'beta '.repeat(60),'gamma '.repeat(60)];
 const first=pageExtractedItems(entries,{maxChars:800},true);assert.equal(first.duplicate_matches_omitted,1);assert.ok(first.next_offset);assert.ok(JSON.stringify(first).length<1100);
 const next=pageExtractedItems(entries,{maxChars:800,offset:first.next_offset!},true);assert.ok(!first.items.includes(next.items[0]));
 const clipped=pageExtractedItems(['long '.repeat(1000)],{maxChars:800});assert.deepEqual(clipped.truncated_items,[0]);assert.ok(JSON.stringify(clipped).length<1100);
});

test('findings retain source, quote, observation time and inference labels without claiming entailment',()=>{
 const ledger=new BrowserFindings(),source={url:'https://shop.example/product',title:'Product',text:'Example GPU\nPrice: $2,899\nIn stock'};
 const [row]=ledger.record(source,[{statement:'The listed price is $2,899',quote:'Price: $2,899'}]);
 assert.equal(row.url,source.url);assert.equal(row.kind,'observation');assert.equal(row.support,'matched_page_text');assert.ok(Date.parse(row.observed_at));
 const [again]=ledger.record(source,[{statement:'The listed price is $2,899',quote:'Price: $2,899'}]);assert.equal(again.id,row.id);assert.equal(ledger.list().length,1);
 assert.throws(()=>ledger.record(source,[{statement:'A supported item',quote:'In stock'},{statement:'It is quieter',quote:'Guaranteed quieter'}]),/not found/);assert.equal(ledger.list().length,1,'invalid batches do not partially record');
 const [inference]=ledger.record(source,[{statement:'May be suitable if price is the priority',quote:'Price: $2,899',kind:'inference'}]);assert.equal(inference.kind,'inference');
 const [lead]=new BrowserFindings().record({...source,url:'https://www.google.com/search?q=GPU'},[{statement:'A search lead lists a price',quote:'Price: $2,899'}]);assert.equal(lead.support,'search_lead');
});

const snapshot=(time:string,ref:string,text:string)=>`OBSERVED_AT: ${time}\nPAGE_CONTEXT:\nmain: {"focus":"page"}\nSNAPSHOT_REFS:\n  ${ref} button "Buy"\nREADABLE_CONTENT:\n${text}\nA11Y_TREE_EXCERPT:\n`;
test('same-page deltas preserve changed and expired refs and targeted content without rewriting prior history',()=>{
 const observations=new BrowserObservations(),url='https://shop.example/product';
 const text='Intro '.repeat(500)+'Price: $2,999. More text.';
 const original=snapshot('first','e1',text);
 assert.equal(observations.format(url,original),original);
 const unchanged=observations.format(url,snapshot('second','e1',text));assert.match(unchanged,/No reported text\/control changes/);assert.ok(unchanged.length<original.length/4);
 const delta=observations.format(url,snapshot('third','e2',text.replace('$2,999','$2,899')));
 assert.match(delta,/EXPIRED_REFS: e1/);assert.match(delta,/e2 button/);assert.match(delta,/\$2,899/);assert.ok(delta.length<original.length/2);
 const other=snapshot('fourth','e3','Other product');assert.equal(observations.format('https://shop.example/other',other),other);
 assert.match(observations.format(url,snapshot('fifth','e4',text)),/OBSERVATION_DELTA/);
 const full=snapshot('sixth','e5',text);assert.equal(observations.format(url,full,true),full);
});
