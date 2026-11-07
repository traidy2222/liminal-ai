import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createServer} from 'node:http';
import {readBrowserWorkspace} from '../../../dist/families/browser/browser_profile.js';
import {restoreBrowserWorkspace,browserWorkspaceState,openBrowserSession,shutdownBrowserWorkspace} from '../../../dist/families/browser/browser_runtime.js';

test('saved tabs across many chats remain dormant and never exhaust a new chat’s live capacity',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'liminal-saved-tabs-'));
 const keys=['LIMINAL_BROWSER_DATA_DIR','AGENT_BROWSER_MAX_LIVE_TABS','AGENT_BROWSER_MAX_SESSIONS'] as const;
 const previous=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 process.env.LIMINAL_BROWSER_DATA_DIR=root;process.env.AGENT_BROWSER_MAX_LIVE_TABS='2';process.env.AGENT_BROWSER_MAX_SESSIONS='2';
 const server=createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<title>Capacity fixture</title><p>Ready</p>');});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address();assert.ok(address&&typeof address!=='string');const url=`http://127.0.0.1:${address.port}/`;
 const tabs=Array.from({length:48},(_,i)=>({sessionId:'saved-'+i,ownerTaskId:'old-chat-'+i,url,title:'Saved page',paused:false}));
 await fs.writeFile(path.join(root,'workspace.json'),JSON.stringify({version:1,tabs,selectedTabs:{'old-chat-47':'saved-47'},history:[]}));
 try {
  assert.equal(readBrowserWorkspace().tabs.length,48);
  await restoreBrowserWorkspace();
  assert.equal(browserWorkspaceState().liveTabCount,0);
  assert.equal(browserWorkspaceState().suspendedTabCount,48);
  const open=()=>openBrowserSession({ownerTaskId:'new-chat',href:url,waitUntil:'load',navTimeoutMs:5000,postWaitMs:0,includeConsole:false,includeSnapshot:false});
  const first=await open();assert.ok(first.ok,first.ok?'':first.error);
  const second=await open();assert.ok(second.ok,second.ok?'':second.error);
  const blocked=await open();assert.equal(blocked.ok,false);
  assert.ok(!blocked.ok&&blocked.error.includes('Browser session limit (2)'));
  assert.equal(browserWorkspaceState().liveTabCount,2);
  assert.equal(readBrowserWorkspace().tabs.length,50,'saving a new tab must not truncate older chats');
  assert.equal(browserWorkspaceState('old-chat-47').selectedTabId,'saved-47');
 } finally {
  await shutdownBrowserWorkspace();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));
  for(const k of keys){if(previous[k]===undefined)delete process.env[k];else process.env[k]=previous[k];}
  await fs.rm(root,{recursive:true,force:true});
 }
});
