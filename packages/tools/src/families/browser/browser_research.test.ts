import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { clickBrowserControl, buildPageSnapshot, navigateWithRenderedContent } from "../../../dist/families/browser/browser_runtime.js";
import { googleSearchUrl } from "../../../dist/families/browser/browser_tools.js";

test("Google queries preserve exact phrases, source and date operators", () => {
  const query='site:example.com "original statement" after:2026-11-01 -commentary';
  const url=new URL(googleSearchUrl(query));
  assert.equal(url.origin,'https://www.google.com');assert.equal(url.searchParams.get('q'),query);
});

test('missing and ambiguous click targets fail promptly with available candidates',async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();await page.setContent('<main><a href="https://example.com/a">Example GPU</a><a href="https://example.com/b">Example GPU</a></main>');
  const started=Date.now();await assert.rejects(clickBrowserControl(page,page.getByText('Example GPU'),15000),/AMBIGUOUS_TARGET.*example.com\/a.*example.com\/b/);
  assert.ok(Date.now()-started<2000);assert.equal(page.url(),'about:blank');
  const missing=Date.now();await assert.rejects(clickBrowserControl(page,page.locator('#missing-filter-button'),15000),/TARGET_NOT_FOUND/);assert.ok(Date.now()-missing<3500);
 }finally{await browser.close();}
});

test("slow secondary resources preserve a readable document, while missing documents stay failures",async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();const held:any[]=[];
    await page.route('**/*',route=>{
      if(route.request().url().includes('/hold')){held.push(route);return;}
      return route.fulfill({contentType:'text/html',body:'<title>Original report</title><main><h1>Original report</h1>'+('Readable source text. '.repeat(60))+'<img src="/hold-image"></main>'});
    });
    const warning=await navigateWithRenderedContent(page,'https://example.test/article',{waitUntil:'load',timeout:350});
    assert.match(warning??'',/Showing the rendered source document/);
    await Promise.all(held.splice(0).map(route=>route.abort().catch(()=>{})));
    await assert.rejects(navigateWithRenderedContent(page,'https://example.test/hold-document',{waitUntil:'domcontentloaded',timeout:350}));
    await Promise.all(held.map(route=>route.abort().catch(()=>{})));
  }finally{await browser.close();}
});

test("equivalent overlaid news links click normally without forcing unrelated overlays", async () => {
  const browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage();
    await page.setContent(`<main><div style="position:relative;width:400px;height:70px"><a id="headline" href="https://example.com/original" style="display:block;width:400px;height:70px">Original report</a><a id="overlay" aria-hidden="true" href="https://example.com/original" style="position:absolute;inset:0" onclick="event.preventDefault();window.clicked='same-destination'"></a></div></main>`);
    await clickBrowserControl(page,page.locator('#headline'),1500);
    assert.equal(await page.evaluate(()=> (window as any).clicked),'same-destination');
    const snapshot=await buildPageSnapshot(page);assert.match(snapshot.snapshotText,/href="https:\/\/example.com\/original"/);
    await page.locator('#overlay').evaluate(el=>el.setAttribute('href','https://example.com/unrelated'));
    await page.evaluate(()=>{(window as any).clicked=undefined;});
    await assert.rejects(clickBrowserControl(page,page.locator('#headline'),400));
    assert.equal(await page.evaluate(()=> (window as any).clicked),undefined);
    await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<main><h1>Search results</h1><p>'+('Source lead. '.repeat(600))+'</p></main>'}));
    await page.goto('https://www.google.com/search?q=precise+claim');
    const observed=await buildPageSnapshot(page);
    assert.match(observed.snapshotText,/"page_kind":"search_results"/);
    assert.match(observed.snapshotText,/"truncated":true/);
  } finally {await browser.close();}
});
