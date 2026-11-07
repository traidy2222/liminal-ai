import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {createServer} from 'node:http';
import {openBrowserSession,getBrowserSession,waitForInSession,actOnBrowserSession,shutdownBrowserWorkspace} from '../../../dist/families/browser/browser_runtime.js';

test('wait returns fresh usable controls and the actual screen after an unmet condition',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'liminal-wait-')),previous=process.env.LIMINAL_BROWSER_DATA_DIR;process.env.LIMINAL_BROWSER_DATA_DIR=root;
 const server=createServer((_req,res)=>{res.setHeader('content-type','text/html');res.end('<h1>Preparing</h1><script>setTimeout(()=>document.body.innerHTML=`<h1>Profile ready</h1><button onclick="document.body.innerHTML=\'<h1>Workspace ready</h1>\'">Continue</button>`,100)</script>');});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address();assert.ok(address&&typeof address!=='string');
 try{
  const opened=await openBrowserSession({ownerTaskId:'wait-test',href:`http://127.0.0.1:${address.port}`,waitUntil:'load',navTimeoutMs:5000,postWaitMs:0,includeConsole:false,includeSnapshot:false});assert.ok(opened.ok,opened.ok?'':opened.error);
  const ready=await waitForInSession(opened.sessionId,{condition:'text',text:'Profile ready',timeoutMs:2000});assert.ok(ready.ok,ready.ok?'':ready.error);assert.match(ready.output,/WAIT_MET/);assert.match(ready.output,/SNAPSHOT_REFS/);
  const ref=ready.output.match(/(e\d+) button "Continue"/)?.[1];assert.ok(ref,ready.output);
  const acted=await actOnBrowserSession({sessionId:opened.sessionId,actions:[{op:'click_ref',ref}],postActionWaitMs:0,refreshSnapshot:true,includeConsole:false});assert.ok(acted.ok,acted.ok?'':acted.error);assert.equal(await getBrowserSession(opened.sessionId)!.page.locator('h1').innerText(),'Workspace ready');
  const missed=await waitForInSession(opened.sessionId,{condition:'url_contains',urlPattern:'never-existing-dashboard',timeoutMs:50});assert.equal(missed.ok,false);if(!missed.ok){assert.match(missed.error,/CURRENT_PAGE_AFTER_WAIT/);assert.match(missed.error,/Workspace ready/);}
 }finally{await shutdownBrowserWorkspace();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));if(previous===undefined)delete process.env.LIMINAL_BROWSER_DATA_DIR;else process.env.LIMINAL_BROWSER_DATA_DIR=previous;await fs.rm(root,{recursive:true,force:true});}
});
