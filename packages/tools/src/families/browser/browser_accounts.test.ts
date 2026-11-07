import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {createServer} from 'node:http';
import {listSavedAccounts,savedAccountContext} from '@liminal/core';
import {openBrowserSession,browserCredentialAction,navigateBrowserSession,shutdownBrowserWorkspace,snapshotBrowserSession} from '../../../dist/families/browser/browser_runtime.js';
import {readBrowserLoginForFill,savedBrowserLogins} from '../../../dist/families/browser/browser_credentials.js';
import {browserCredentialsTool} from '../../../dist/families/browser/browser_tools.js';
import {rememberTool} from '../memory/remember_recall.js';

test('browser account evidence is recorded across signup redirects, available without a tab, and never authorizes cross-origin password fill',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'liminal-browser-accounts-'));
 const prior={global:process.env.AGENT_GLOBAL_STORAGE_ROOT,browser:process.env.LIMINAL_BROWSER_DATA_DIR};process.env.AGENT_GLOBAL_STORAGE_ROOT=path.join(root,'global');process.env.LIMINAL_BROWSER_DATA_DIR=path.join(root,'browser');
 const make=()=>createServer((_req,res)=>{res.setHeader('content-type','text/html');res.end('<title>Account</title><h1>Account created for fixture-user</h1><label>Password<input type="password"></label>');});
 const signup=make(),app=make();for(const server of [signup,app])await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const url=(server:typeof signup)=>{const a=server.address();assert.ok(a&&typeof a!=='string');return `http://127.0.0.1:${a.port}/`;};
 try{
  const opened=await openBrowserSession({ownerTaskId:'account-fixture',href:url(signup),waitUntil:'load',navTimeoutMs:5000,postWaitMs:0,includeSnapshot:true,includeConsole:false});assert.ok(opened.ok,opened.ok?'':opened.error);
  const prepared=await browserCredentialAction({action:'prepare',session_id:opened.sessionId,username:'fixture-user-original',owner:'assistant'});assert.ok(prepared.ok);const login=JSON.parse(prepared.output!).login;
  assert.equal(login.passwordState,'stored');assert.equal(listSavedAccounts()[0]!.loginMethod,'unknown');
  const originalSecret=readBrowserLoginForFill(url(signup),login.id).password;
  const beforeFill=await snapshotBrowserSession(opened.sessionId,false);assert.ok(beforeFill.ok);const auth=JSON.parse(beforeFill.output.split('\n').find(line=>line.startsWith('AUTHENTICATION_CONTEXT: '))!.slice('AUTHENTICATION_CONTEXT: '.length));assert.equal(auth.site_password_exists,'unknown');assert.equal(auth.local_passwords[0].state,'stored');
  const passwordRef=beforeFill.output.match(/(e\d+) textbox "Password"/)![1]!;const filled=await browserCredentialAction({action:'fill',session_id:opened.sessionId,credential_id:login.id,password_ref:passwordRef});assert.ok(filled.ok);
  assert.equal(savedBrowserLogins(url(signup))[0]!.passwordState,'filled');assert.ok(savedBrowserLogins(url(signup))[0]!.lastFilledAt);assert.equal(readBrowserLoginForFill(url(signup),login.id).password,originalSecret);
  const afterFill=await snapshotBrowserSession(opened.sessionId,false);assert.ok(afterFill.ok);assert.match(afterFill.output,/"state":"filled"/);assert.ok(!afterFill.output.includes(originalSecret));
  assert.equal(listSavedAccounts()[0]!.status,'prepared');
  const nav=await navigateBrowserSession({sessionId:opened.sessionId,href:url(app),waitUntil:'load',navTimeoutMs:5000,postWaitMs:0,includeConsole:false});assert.ok(nav.ok);
  const invalid=await browserCredentialAction({action:'record_account',session_id:opened.sessionId,credential_id:login.id,username:'fixture-user',evidence:'A nonexistent account confirmation'});assert.equal(invalid.ok,false);
  assert.match(invalid.error!,/ACCOUNT_EVIDENCE_MISMATCH/);assert.match(invalid.error!,/Account created for fixture-user/);assert.equal(listSavedAccounts()[0]!.status,'prepared');assert.ok(!invalid.error!.includes(originalSecret));
  const recorded=await browserCredentialAction({action:'record_account',session_id:opened.sessionId,credential_id:login.id,username:'fixture-user',owner:'assistant',evidence:'Account created for fixture-user'});assert.ok(recorded.ok,recorded.ok?'':recorded.error);
  const account=listSavedAccounts()[0]!;assert.equal(account.origin,new URL(url(signup)).origin);assert.equal(account.profileUrl,url(app));assert.equal(account.credentialId,login.id);assert.equal(account.status,'active');
  const accounts=await browserCredentialsTool.handler({action:'accounts'},undefined,{taskId:'brand-new-chat'} as any);assert.ok(accounts.ok);assert.match(accounts.output!,/fixture-user/);
  const secret=readBrowserLoginForFill(url(signup),login.id).password;
  assert.equal(secret,originalSecret);assert.equal(readBrowserLoginForFill(url(signup),login.id).username,'fixture-user');
  assert.ok(!JSON.stringify(accounts).includes(secret));assert.ok(!(await savedAccountContext('Follow up on your account')).includes(secret));assert.throws(()=>readBrowserLoginForFill(url(app),login.id),/different origin/);
  const next=await browserCredentialAction({action:'prepare',session_id:opened.sessionId,username:'provisional-name',owner:'assistant'});assert.ok(next.ok);const nextId=JSON.parse(next.output!).login.id;
  const note=await rememberTool.handler({key:'second_account',type:'fact',scope:'global',value:`Account created.\nOrigin: ${url(app)}\nUsername: confirmed-name`},undefined,{taskId:'account-fixture'} as any);
  assert.ok(note.ok);assert.equal(readBrowserLoginForFill(url(app),nextId).username,'confirmed-name');assert.equal(listSavedAccounts().find(a=>a.credentialId===nextId)?.status,'reported');
 }finally{await shutdownBrowserWorkspace();for(const server of [signup,app]){server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}if(prior.global===undefined)delete process.env.AGENT_GLOBAL_STORAGE_ROOT;else process.env.AGENT_GLOBAL_STORAGE_ROOT=prior.global;if(prior.browser===undefined)delete process.env.LIMINAL_BROWSER_DATA_DIR;else process.env.LIMINAL_BROWSER_DATA_DIR=prior.browser;await fs.rm(root,{recursive:true,force:true});}
});

test('passwordless accounts use live untruncated page evidence and cannot retain an unused generated password',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'liminal-passwordless-')),prior={global:process.env.AGENT_GLOBAL_STORAGE_ROOT,browser:process.env.LIMINAL_BROWSER_DATA_DIR};process.env.AGENT_GLOBAL_STORAGE_ROOT=root;process.env.LIMINAL_BROWSER_DATA_DIR=path.join(root,'browser');
 const server=createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<main>'+('Navigation text '.repeat(1200))+'<h1>Signed in as code-user</h1></main>');});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address();assert.ok(address&&typeof address!=='string');
 try{
  const opened=await openBrowserSession({ownerTaskId:'code-user',href:`http://127.0.0.1:${address.port}`,waitUntil:'load',navTimeoutMs:5000,postWaitMs:0,includeConsole:false,includeSnapshot:false});assert.ok(opened.ok);
  const sessionOnly=await browserCredentialAction({action:'record_account',session_id:opened.sessionId,username:'code-user',owner:'assistant',evidence:'Signed in as code-user'});assert.ok(sessionOnly.ok);const known=JSON.parse(sessionOnly.output!).account;assert.equal(known.loginMethod,'unknown');assert.equal(known.credentialId,undefined);
  const prepared=await browserCredentialAction({action:'prepare',session_id:opened.sessionId,username:'code-user'});assert.ok(prepared.ok);const id=JSON.parse(prepared.output!).login.id;
  const bad=await browserCredentialAction({action:'record_account',session_id:opened.sessionId,username:'code-user',credential_id:id,login_method:'email_code',evidence:'Signed in as code-user'});assert.equal(bad.ok,false);assert.match(bad.error!,/must not link/);
  const recorded=await browserCredentialAction({action:'record_account',session_id:opened.sessionId,username:'code-user',owner:'assistant',login_method:'email_code',evidence:'Signed in as code-user'});assert.ok(recorded.ok,recorded.ok?'':recorded.error);const receipt=JSON.parse(recorded.output!);assert.equal(receipt.operation,'upsert');assert.equal(receipt.replaced_existing_record,true);assert.equal(receipt.current_records_for_this_login,1);const account=listSavedAccounts()[0]!;assert.equal(account.loginMethod,'email_code');assert.equal(account.credentialId,undefined);
 }finally{await shutdownBrowserWorkspace();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));for(const [key,value] of [['AGENT_GLOBAL_STORAGE_ROOT',prior.global],['LIMINAL_BROWSER_DATA_DIR',prior.browser]])if(value===undefined)delete process.env[key!];else process.env[key!]=value;await fs.rm(root,{recursive:true,force:true});}
});
