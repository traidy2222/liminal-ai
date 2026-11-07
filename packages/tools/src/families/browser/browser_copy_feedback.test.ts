import test from 'node:test';import assert from 'node:assert/strict';import {chromium} from 'playwright';
import {observeBrowserCopyLinks} from '../../../dist/families/browser/browser_copy_feedback.js';

test('action-scoped copy feedback captures page-provided links without reading old clipboard contents',async()=>{
 const browser=await chromium.launch({headless:true});try{const page=await browser.newPage();
  await page.setContent('<button>Copy internal link</button><script>window.writes=0;window.originalWrite=async()=>{window.writes++};Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:window.originalWrite,readText:()=>{throw Error("Must never read clipboard")}}});document.querySelector("button").onclick=()=>navigator.clipboard.writeText("simplenote://note/private-fixture")</script>');
  const finish=await observeBrowserCopyLinks(page);await page.getByRole('button').click();assert.deepEqual(await finish(),['simplenote://note/private-fixture']);assert.deepEqual(await finish(),['simplenote://note/private-fixture']);
  assert.equal(await page.evaluate(()=>navigator.clipboard.writeText===(window as any).originalWrite),true);assert.equal(await page.evaluate(()=>(window as any).writes),1);
  const quiet=await observeBrowserCopyLinks(page);assert.deepEqual(await quiet(),[],'no stale result from the previous action');
  const legacy=await observeBrowserCopyLinks(page);await page.evaluate(()=>{const event=new ClipboardEvent('copy',{clipboardData:new DataTransfer(),bubbles:true});event.clipboardData!.setData('text/plain','https://example.org/private-note');document.dispatchEvent(event);});assert.deepEqual(await legacy(),['https://example.org/private-note']);
  await page.setContent('<button onclick="const span=document.createElement(\'span\');span.textContent=\'temporary selection\';document.body.append(span);const range=document.createRange();range.selectNodeContents(span);getSelection().removeAllRanges();getSelection().addRange(range);span.addEventListener(\'copy\',e=>{e.stopPropagation();e.preventDefault();e.clipboardData.setData(\'text/plain\',\'simplenote://note/legacy-fixture\')});document.execCommand(\'copy\');span.remove()">Copy legacy link</button>');
  const actualCopy=await observeBrowserCopyLinks(page);await page.getByRole('button').click();assert.deepEqual(await actualCopy(),['simplenote://note/legacy-fixture']);
  await page.setContent('<button onclick="const field=document.createElement(\'textarea\');field.readOnly=true;field.style.cssText=\'position:absolute;left:-9999px\';field.value=\'simplenote://note/default-copy-fixture\';document.body.append(field);field.select();document.execCommand(\'copy\');field.remove()">Copy through temporary field</button>');
  const temporary=await observeBrowserCopyLinks(page);await page.getByRole('button').click();assert.deepEqual(await temporary(),['simplenote://note/default-copy-fixture']);
  const markdown=await observeBrowserCopyLinks(page);await page.evaluate(()=>navigator.clipboard.writeText('[Northlight Launch — Handoff](simplenote://note/markdown-fixture)'));assert.deepEqual(await markdown(),['simplenote://note/markdown-fixture']);
  const unsafe=await observeBrowserCopyLinks(page);await page.evaluate(async()=>{await navigator.clipboard.writeText('unrelated text');await navigator.clipboard.writeText('https://user:password@example.org/');});assert.deepEqual(await unsafe(),[]);
 }finally{await browser.close();}
});
