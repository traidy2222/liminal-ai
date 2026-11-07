import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {saveAccount,listSavedAccounts,indexAccountMemory,savedAccountContext} from './account_directory.js';
import {AgentHarness} from './agent.js';
const credentialId='11111111-1111-4111-8111-111111111111';
async function isolated(run:(root:string)=>Promise<void>){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'liminal-accounts-')),previous=process.env.AGENT_GLOBAL_STORAGE_ROOT;
 process.env.AGENT_GLOBAL_STORAGE_ROOT=root;
 try{await run(root);}finally{if(previous===undefined)delete process.env.AGENT_GLOBAL_STORAGE_ROOT;else process.env.AGENT_GLOBAL_STORAGE_ROOT=previous;await fs.rm(root,{recursive:true,force:true});}
}

test('a stored generated password does not infer the website login method',async()=>isolated(async()=>{
 const prepared=saveAccount({origin:'https://unknown.example.test',username:'assistant',status:'prepared',credentialId});
 assert.equal(prepared.loginMethod,'unknown');assert.equal(prepared.credentialId,credentialId);
 const active=saveAccount({origin:prepared.origin,username:prepared.username,status:'active',loginMethod:'unknown'});
 assert.equal(active.loginMethod,'unknown');assert.equal(active.credentialId,credentialId);
 saveAccount({origin:active.origin,username:active.username,status:'prepared',credentialId});assert.equal(listSavedAccounts()[0]!.loginMethod,'unknown');
 const context=await savedAccountContext('Use unknown.example.test');assert.match(context,/"login_method":"unknown"/);assert.match(context,/"local_password":"stored"/);assert.match(context,new RegExp(credentialId));
}));
test('account metadata links credentials without persisting secrets or downgrading confirmed status',async()=>isolated(async root=>{
 const prepared=saveAccount({origin:'https://accounts.example.test/signup?token=private',username:'detective',status:'prepared',credentialId,password:'never-store-this'} as any);
 const active=saveAccount({origin:prepared.origin,username:'detective@example.test',email:'detective@example.test',owner:'assistant',status:'active',profileUrl:'https://mail.example.test/inbox?token=private'});
 assert.equal(active.id,prepared.id);assert.equal(active.credentialId,credentialId);assert.equal(active.profileUrl,'https://mail.example.test/inbox');
 const again=saveAccount({origin:prepared.origin,username:'detective',status:'prepared',credentialId});
 assert.equal(again.status,'active');assert.equal(again.owner,'assistant');assert.equal(again.updatedAt,active.updatedAt,'metadata reads must not churn last-updated time');
 const raw=await fs.readFile(path.join(root,'accounts',active.id+'.json'),'utf8');assert.doesNotMatch(raw,/never-store-this|token=private|encryptedPassword/);assert.equal(Object.hasOwn(JSON.parse(raw),'password'),false);
}));
test('existing global account facts migrate with full credential links; failures and project notes do not',async()=>isolated(async root=>{
 saveAccount({origin:'https://account.example.test',username:'detective',credentialId,status:'prepared'});
 await fs.writeFile(path.join(root,'notes.json'),JSON.stringify({
  'fact:mail_account':{scope:'global',value:'[migrated_to_vault:Mail] Mail account created today.\nAddress: detective@example.test\nOrigin: https://account.example.test\nCredential store ID: 11111111-1111-4111-'},
  'reflection:account_failure':{scope:'global',value:'Account created? No. Username: wrong\nOrigin: https://other.test'},
  'fact:project_account':{scope:'workspace',value:'Account created\nUsername: project\nOrigin: https://project.test'},
  'fact:failed_account':{scope:'global',value:'Account not created.\nUsername: failed\nOrigin: https://failed.test'},
 }));
 const context=await savedAccountContext('Send from your email');
 assert.match(context,/detective@example.test/);assert.match(context,new RegExp(credentialId));assert.doesNotMatch(context,/project\.test|failed\.test|other\.test/);
 assert.equal(listSavedAccounts().length,1);assert.equal(listSavedAccounts()[0]!.status,'reported');
 assert.equal(indexAccountMemory('fact:ordinary_note','Account created. Username: x\nOrigin: https://x.test','global'),undefined);
 assert.equal(indexAccountMemory('entity:another_account','Another account attempt uses an email from a created mail account: detective@example.test','global'),undefined,'a contact email must not become a separate service account');
}));
test('www redirects link truncated account notes to secure logins without duplicate records or origin churn',async()=>isolated(async()=>{
 indexAccountMemory('fact:community_account','[migrated_to_vault:Community] community.test account created today.\nUsername: Detective\nEmail: detective@example.test','global');
 saveAccount({origin:'https://www.community.test',username:'Detective',credentialId,status:'prepared'});
 assert.equal(listSavedAccounts().length,1);assert.equal(listSavedAccounts()[0]!.origin,'https://www.community.test');assert.equal(listSavedAccounts()[0]!.credentialId,credentialId);
 indexAccountMemory('fact:community_account','community.test account created today.\nUsername: Detective','global');
 assert.equal(listSavedAccounts()[0]!.origin,'https://www.community.test');
}));
test('a completed account fact links the single signup credential from the same chat when the site changes the username',async()=>isolated(async()=>{
 saveAccount({origin:'https://community.test',username:'DetectiveLongName',credentialId,status:'prepared',sourceChat:'signup-chat'});
 const result=indexAccountMemory('fact:community_account','community.test account created.\nUsername: Detective','global','signup-chat');
 assert.equal(result?.credentialId,credentialId);assert.equal(result?.username,'Detective');assert.equal(listSavedAccounts().length,1);
}));
test('uncued follow-ups see known accounts, with bounded metadata and no false success for prepared logins',async()=>isolated(async()=>{
 saveAccount({origin:'https://signup.outlook.test',username:'pending',status:'prepared'});
 saveAccount({origin:'https://mail.example.test',username:'detective',email:'detective@example.test',owner:'assistant',status:'active'});
 assert.match(await savedAccountContext('Can you take care of that?'),/detective@example.test/);
 assert.doesNotMatch(await savedAccountContext('Send from your own email'),/pending/);
 assert.match(await savedAccountContext('Continue Outlook signup'),/signup unconfirmed|prepared/);
 for(let i=0;i<12;i++)saveAccount({origin:`https://service${i}.test`,username:'member',status:'reported'});
 const text=await savedAccountContext('Use service0');assert.ok(text.length<6000);assert.match(text,/service0\.test/);assert.equal((text.match(/account_id/g)||[]).length,8);
}));
test('fresh harnesses receive accounts before the first model request without a recall tool or extra completion',async()=>isolated(async()=>{
 saveAccount({origin:'https://mail.example.test',username:'detective',email:'detective@example.test',owner:'assistant',status:'active'});
 const keys=['AGENT_INTENT_INFERENCE','AGENT_WORLD_CONTEXT','AGENT_SESSION_JSONL','AGENT_TRAJECTORY_WRITE','AGENT_EFFORT_LEARN'] as const;
 const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));for(const k of keys)process.env[k]='0';
 try{for(let i=0;i<2;i++){
  const h=new AgentHarness({openRouterApiKey:'offline',baseURL:'http://127.0.0.1:1',model:'offline',worldContext:{disabled:true},proceduralMemory:{enabled:false},context:{inceptionMessages:[{role:'system',content:'Stable prefix'}],modelMaxTokens:100000,thresholdFraction:.95}});
  let calls=0;(h as any).streamWithRetry=async(messages:any[])=>{calls++;assert.match(JSON.stringify(messages),/detective@example.test/);assert.equal(messages[0].content,'Stable prefix');return(async function*(){yield{choices:[{index:0,delta:{content:'Your account is available.'},finish_reason:'stop'}]};})();};
  try{await h.send('Which email address can you use?');assert.equal(calls,1);assert.ok(!h.registry.has('recall_relevant'));assert.ok(!h.getContext().getConversationMessages().some(m=>String(m.content).includes('SAVED ACCOUNTS')));}finally{h.closeProcedureRuntime();}
 }}finally{for(const k of keys){if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];}}
}));

test('email-code accounts discard unused password references and retain login method in follow-up context',async()=>isolated(async()=>{
 saveAccount({origin:'https://outline.example.test',username:'assistant@example.test',status:'prepared',credentialId});
 const active=saveAccount({origin:'https://outline.example.test',username:'assistant@example.test',status:'active',loginMethod:'email_code',owner:'assistant'});
 assert.equal(active.credentialId,undefined);assert.equal(active.loginMethod,'email_code');
 saveAccount({origin:active.origin,username:active.username,status:'prepared',credentialId});
 const reloaded=listSavedAccounts()[0]!;assert.equal(reloaded.credentialId,undefined);assert.equal(reloaded.status,'active');assert.equal(reloaded.loginMethod,'email_code');
 const context=await savedAccountContext('Use your outline account');assert.match(context,/email_code/);assert.ok(!context.includes(credentialId));
}));

test('recording an account refreshes the current turn snapshot before the next model request',async()=>isolated(async()=>{
 saveAccount({origin:'https://outline.example.test',username:'assistant@example.test',status:'prepared',credentialId});
 const h=new AgentHarness({openRouterApiKey:'offline',baseURL:'http://127.0.0.1:1',model:'offline',worldContext:{disabled:true},proceduralMemory:{enabled:false},context:{inceptionMessages:[],modelMaxTokens:100000,thresholdFraction:.9}}),s=h as any;
 s.lastUserMessage='Remember the outline account';s.sendStartTime=Date.now();h.getContext().setTurnContext('saved_accounts',await savedAccountContext(s.lastUserMessage));
 h.registry.register({name:'browser_credentials',description:'fixture',requiresApproval:false,parameters:{type:'object',properties:{}},handler:async()=>({ok:true,output:JSON.stringify({account:saveAccount({origin:'https://outline.example.test',username:'assistant@example.test',status:'active',loginMethod:'email_code'}),available_in_new_chats:true,evidence:'matched_current_page'})})});
 let calls=0;s.streamWithRetry=async(messages:any[])=>{calls++;return(async function*(){if(calls===1)yield{choices:[{index:0,delta:{tool_calls:[{index:0,id:'record-account',type:'function',function:{name:'browser_credentials',arguments:'{}'}}]},finish_reason:'tool_calls'}]};else{const block=messages.find(m=>m.role==='system'&&typeof m.content==='string'&&m.content.includes('SAVED ACCOUNTS'))?.content;assert.match(block,/email_code/);assert.ok(!block.includes('credential_id'));yield{choices:[{index:0,delta:{content:'The account uses email codes.'},finish_reason:'stop'}]};}})();};
 try{await s.runReActLoop();assert.equal(calls,2);}finally{h.closeProcedureRuntime();}
}));
