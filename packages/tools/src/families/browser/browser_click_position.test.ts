import test from 'node:test';import assert from 'node:assert/strict';import {chromium} from 'playwright';
import {clickBrowserControl,buildPageSnapshot} from '../../../dist/families/browser/browser_runtime.js';

test('styled radio and checkbox inputs click their real associated labels without forcing',async()=>{
 const browser=await chromium.launch({headless:true});try{const page=await browser.newPage();
  await page.setContent('<style>label{display:inline-block;position:relative;padding:20px}#board{position:absolute;inset:0;width:100%;height:100%}.art{position:absolute;inset:0;background:#ddd}#check{display:none}</style><input id="list" type="radio" name="layout" checked><label for="board"><input id="board" type="radio" name="layout"><span class="art">Board</span></label><input id="check" type="checkbox"><label for="check">Enable</label><input id="disabled" type="checkbox" disabled><label for="disabled">Unavailable</label>');
  await clickBrowserControl(page,page.locator('#board'),1200);assert.equal(await page.locator('#board').isChecked(),true);assert.equal(await page.locator('#list').isChecked(),false);
  await clickBrowserControl(page,page.locator('#check'),1200);assert.equal(await page.locator('#check').isChecked(),true);
  await assert.rejects(clickBrowserControl(page,page.locator('#disabled'),250));assert.equal(await page.locator('#disabled').isChecked(),false);
  await page.setContent('<input id="choice" type="radio"><label for="choice"><a href="#other">Other action</a></label>');
  const {browserAssociatedControlLabel}=await import('../../../dist/families/browser/browser_click_position.js');assert.equal(await browserAssociatedControlLabel(page.locator('#choice')),null);
 }finally{await browser.close();}
});

test('clicking a task row avoids its nested source links and completion control',async()=>{
 const browser=await chromium.launch({headless:true});try{const page=await browser.newPage();await page.setContent('<style>#row{position:relative;width:520px;height:130px;padding:8px;border:2px solid}a{position:absolute;left:0;top:35px;width:100%;height:70px;background:#ddd}</style><div id="row" role="button" aria-label="Task: Read competitor sources">Read competitor sources<a href="#source">Source pricing</a><input type="checkbox" style="position:absolute;bottom:0;left:0"></div><script>window.state={opened:0,followed:0};document.querySelector("#row").onclick=()=>state.opened++;document.querySelector("a").onclick=e=>{e.preventDefault();e.stopPropagation();state.followed++};</script>');
  await clickBrowserControl(page,page.getByRole('button',{name:'Task: Read competitor sources',exact:true}),2000);assert.deepEqual(await page.evaluate(()=>(window as any).state),{opened:1,followed:0});assert.equal(await page.locator('input').isChecked(),false);
  await clickBrowserControl(page,page.getByRole('link',{name:'Source pricing'}),2000);assert.deepEqual(await page.evaluate(()=>(window as any).state),{opened:1,followed:1});
  await page.locator('a').evaluate(el=>(el as HTMLElement).style.cssText='position:absolute;inset:0;width:100%;height:100%');await assert.rejects(clickBrowserControl(page,page.locator('#row'),1000),/TARGET_NOT_HITTABLE/);assert.equal(await page.evaluate(()=>(window as any).state.opened),1);
 }finally{await browser.close();}
});

test('card buttons use an exposed edge when sibling text covers their centre',async()=>{
 const browser=await chromium.launch({headless:true});try{const page=await browser.newPage();
  await page.setContent('<div style="position:relative;width:400px;height:100px"><button aria-label="Open details" style="position:absolute;inset:0;width:100%;height:100%" onclick="window.opened=true"></button><div id="cover" style="position:absolute;left:30px;right:30px;top:10px;bottom:10px;background:#ddd">Card text</div></div>');
  await clickBrowserControl(page,page.getByRole('button',{name:'Open details'}),1000);assert.equal(await page.evaluate(()=>(window as any).opened),true);
  await page.locator('#cover').evaluate(el=>(el as HTMLElement).style.cssText='position:absolute;inset:0;background:#ddd');await assert.rejects(clickBrowserControl(page,page.getByRole('button',{name:'Open details'}),1000),/TARGET_NOT_HITTABLE/);
 }finally{await browser.close();}
});

test('repeated card detail buttons carry their own nearby title even without list semantics',async()=>{
 const browser=await chromium.launch({headless:true});try{const page=await browser.newPage();await page.setContent('<main>'+['Write positioning pitch','Price launch offer'].map(title=>`<div><button aria-label="Open task details"></button><div><input type="checkbox"><span>${title}</span></div></div>`).join('')+'</main>');const shot=await buildPageSnapshot(page);
  for(const title of ['Write positioning pitch','Price launch offer'])assert.match(shot.snapshotText,new RegExp('button "Open task details"[^\\n]*row="'+title+'"'));
 }finally{await browser.close();}
});
test('empty editors expose empty values separately from suggested placeholder text',async()=>{
 const browser=await chromium.launch({headless:true});try{const page=await browser.newPage();await page.setContent('<div role="textbox" aria-label="Task name" contenteditable="true" aria-placeholder="Read documents for Tue workshop"><br></div><input aria-label="Other task" placeholder="Submit travel form by next Wed">');const shot=await buildPageSnapshot(page);assert.match(shot.snapshotText,/textbox "Task name"[^\n]*value=""[^\n]*placeholder="Read documents for Tue workshop"/);assert.match(shot.snapshotText,/textbox "Other task"[^\n]*value=""[^\n]*placeholder="Submit travel form/);
 }finally{await browser.close();}
});

test('editor spans retain real word boundaries and covered text entry fails promptly',async()=>{
 const browser=await chromium.launch({headless:true});try{const page=await browser.newPage();
  await page.setContent('<p>Ma<span>ya</span>: ready next <span>Tue</span>sday.</p><p><span>Leo</span> <span>owns</span> the draft. <del>Old price</del></p><p>Keep <span hidden>secret</span>this.</p><div style="position:relative;width:300px;height:40px"><div contenteditable="true" aria-label="Tags" style="position:absolute;inset:0"></div><span aria-hidden="true" style="position:absolute;inset:0">Add tag…</span></div>');
  const shot=await buildPageSnapshot(page);assert.match(shot.snapshotText,/Maya: ready next Tuesday/);assert.match(shot.snapshotText,/Leo owns the draft/);assert.match(shot.snapshotText,/Keep this/);assert.match(shot.snapshotText,/\[struck through\] Old price/);assert.doesNotMatch(shot.snapshotText,/Ma ya|Tue sday|secret/);
  const started=performance.now();await assert.rejects(clickBrowserControl(page,page.locator('[contenteditable]'),15000),/TARGET_NOT_HITTABLE.*focus_ref/);assert.ok(performance.now()-started<2000);
 }finally{await browser.close();}
});
test('repeated action buttons retain named section context after a dense linked task list',async()=>{
 const browser=await chromium.launch({headless:true});try{const page=await browser.newPage();await page.setContent('<main>'+['Research','Positioning','Build','Launch'].map((name,i)=>`<section aria-label="${name}"><h2>${name}</h2>${i===0?Array.from({length:20},(_,n)=>`<li role="button" aria-label="Task ${n}: many useful sources"><a href="#a${n}">First source</a><a href="#b${n}">Second source</a></li>`).join(''):''}<ul><li><button>Add task</button></li></ul></section>`).join('')+'</main>');
  const shot=await buildPageSnapshot(page);for(const name of ['Research','Positioning','Build','Launch'])assert.match(shot.snapshotText,new RegExp('button "Add task"[^\\n]*section="'+name+'"'));assert.ok(shot.snapshotText.length<9000);
 }finally{await browser.close();}
});
test('large first sections do not crowd later section actions out of the snapshot budget',async()=>{
 const browser=await chromium.launch({headless:true});try{const page=await browser.newPage();await page.setContent('<main>'+['Research','Positioning','Build','Launch'].map((name,i)=>`<li role="button"><section aria-label="${name}"><button>Collapse section</button><button>Edit section ${name}</button><button>More actions</button>${Array.from({length:i===0?12:3},(_,n)=>`<li><button aria-label="Task ${n}: ${'A long task description with useful details '.repeat(5)}">Task ${n}</button><button>Date</button></li>`).join('')}<button>Add task</button></section></li>`).join('')+'</main>');const shot=await buildPageSnapshot(page);for(const name of ['Research','Positioning','Build','Launch'])assert.match(shot.snapshotText,new RegExp('button "Add task"[^\\n]*section="'+name+'"'));
 }finally{await browser.close();}
});
test('named regions provide observed hover anchors for controls revealed only on hover',async()=>{
 const browser=await chromium.launch({headless:true});try{const page=await browser.newPage();await page.setContent('<style>section{width:500px;height:100px}section button{opacity:0}section:hover button{opacity:1}</style><h1>Launch workspace</h1><section aria-label="Launch"><h2>Launch</h2><button>Add task</button></section>');const before=await buildPageSnapshot(page);assert.match(before.snapshotText,/region "Launch"[^\n]*container=true/);assert.doesNotMatch(before.snapshotText,/button "Add task"/);const region=[...before.refs.values()].find(r=>r.role==='region'&&r.name==='Launch');assert.ok(region?.selector);await page.locator(region.selector).hover();const after=await buildPageSnapshot(page);assert.match(after.snapshotText,/button "Add task"[^\n]*section="Launch"/);
 }finally{await browser.close();}
});
