import test from 'node:test';import assert from 'node:assert/strict';import {chromium} from 'playwright';import {scrollBrowserPage} from '../../../dist/families/browser/browser_scroll.js';
test('scrolling moves the main content pane, reports boundaries, and respects an active dialog',async()=>{
 const b=await chromium.launch({headless:true});try{const p=await b.newPage({viewport:{width:1200,height:800}});await p.setContent('<style>body{margin:0;height:100vh;overflow:hidden;display:flex}nav{width:200px;height:100vh;overflow:auto}main{width:1000px;height:100vh;overflow:auto}.long{height:3000px}dialog{height:300px;overflow:auto}</style><nav><div class="long">Navigation</div></nav><main aria-label="Task list"><div class="long">Tasks</div></main><dialog><div class="long"><button>Dialog action</button></div></dialog>');
  const moved=await scrollBrowserPage(p,'down',500);assert.equal(moved.target,'Task list');assert.equal(moved.after,500);assert.equal(await p.locator('nav').evaluate(e=>e.scrollTop),0);assert.equal(await p.evaluate(()=>scrollY),0);
  const bottom=await scrollBrowserPage(p,'bottom');assert.equal(bottom.after,bottom.max);const edge=await scrollBrowserPage(p,'down');assert.equal(edge.moved,false);assert.equal((await scrollBrowserPage(p,'top')).after,0);
  await p.locator('dialog').evaluate(el=>(el as HTMLDialogElement).showModal());await p.getByRole('button',{name:'Dialog action'}).focus();const popup=await scrollBrowserPage(p,'down',120);assert.equal(popup.target,'dialog');assert.equal(popup.after,120);assert.equal(await p.locator('main').evaluate(e=>e.scrollTop),0);
  await p.setContent('<style>body{margin:0}aside{position:fixed;right:0;width:150px;height:600px;overflow:auto}</style><aside><div style="height:2000px">Sidebar</div></aside><article style="height:3000px">Long article</article>');
  const article=await scrollBrowserPage(p,'down',200);assert.equal(article.after,200);assert.equal(await p.evaluate(()=>scrollY),200);assert.equal(await p.locator('aside').evaluate(e=>e.scrollTop),0);
 }finally{await b.close();}
});

test('horizontal board scrolling targets its overflowing pane and preserves vertical position',async()=>{
 const b=await chromium.launch({headless:true});try{const p=await b.newPage({viewport:{width:1200,height:800}});await p.setContent('<style>body{margin:0;height:100vh;overflow:hidden}main{width:100vw;height:80vh;overflow-x:auto;overflow-y:hidden}section{width:3000px;height:200px}</style><main aria-label="Launch board"><section>Research Build Launch</section></main>');
  const right=await scrollBrowserPage(p,'right',500);assert.equal(right.target,'Launch board');assert.equal(right.axis,'x');assert.equal(right.after,500);assert.equal(await p.locator('main').evaluate(el=>el.scrollTop),0);assert.equal((await scrollBrowserPage(p,'left',300)).after,200);
 }finally{await b.close();}
});
