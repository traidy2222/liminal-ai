import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';
import {discoverProviderModels,validateProviderSetup,persistValidatedProvider,normalizeProviderSetup,isLocalProviderUrl,providerConnectionConfigured,UNCONFIGURED_PROVIDER_KEY,providerSetupVerified,ensureProviderSetupVerified} from './provider_setup.js';
import {runHarnessEffectiveEnvContext} from './harness_effective_env.js';
import {getFastModelSlug} from './router.js';
import {resolveProviderConfig} from './provider_config.js';

test('stored generic credentials are bound to their configured endpoint',async()=>{
 const before={...process.env}, original=globalThis.fetch;
 try {
  process.env.AGENT_API_BASE_URL='https://provider.example/v1';
  process.env.AGENT_API_KEY='synthetic-endpoint-secret';
  delete process.env.OPENROUTER_API_KEY;
  assert.equal(normalizeProviderSetup({baseURL:'https://provider.example/v1/'}).apiKey,'synthetic-endpoint-secret');
  assert.equal(normalizeProviderSetup({baseURL:'https://unrelated.example/v1'}).apiKey,'');
  assert.equal(normalizeProviderSetup({baseURL:'https://openrouter.ai/api/v1'}).apiKey,'');
  globalThis.fetch=async(_url,options)=>{
   assert.ok(!JSON.stringify(options?.headers).includes('synthetic-endpoint-secret'));
   return new Response(JSON.stringify({data:[{id:'fixture'}]}));
  };
  await discoverProviderModels({baseURL:'https://unrelated.example/v1'});
 }finally{process.env=before;globalThis.fetch=original;}
});

test('local credentials preserve explicit server configuration and isolate cloud keys',()=>{
 const before={...process.env};const baseURL='http://localhost:1234/v1';
 try{
  process.env.AGENT_API_BASE_URL='https://openrouter.ai/api/v1';
  process.env.AGENT_API_KEY='synthetic-cloud-secret';
  process.env.AGENT_LOCAL_API_KEY='synthetic-local-secret';
  assert.equal(resolveProviderConfig({baseURL}).apiKey,'synthetic-local-secret');
  assert.equal(resolveProviderConfig({baseURL}).keySource,'AGENT_LOCAL_API_KEY');
  delete process.env.AGENT_LOCAL_API_KEY;
  assert.equal(resolveProviderConfig({baseURL}).apiKey,'liminal-local');
  process.env.AGENT_API_BASE_URL=baseURL+'/';
  process.env.AGENT_API_KEY='synthetic-legacy-local-secret';
  assert.equal(resolveProviderConfig({baseURL}).apiKey,'synthetic-legacy-local-secret');
  assert.equal(resolveProviderConfig({baseURL}).keySource,'AGENT_API_KEY');
  assert.equal(resolveProviderConfig({baseURL:'http://localhost:1235/v1'}).apiKey,'liminal-local');
 }finally{process.env=before;}
});

test('local setup discovers loaded models, verifies tools and keeps all auxiliary calls on the chosen local model',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'liminal-provider-setup-'));const before={...process.env};
 const headers:string[]=[];const server=createServer(async(req,res)=>{
  headers.push(req.headers.authorization??'');res.setHeader('Content-Type','application/json');
  if(req.url==='/v1/models'){res.end(JSON.stringify({data:[{id:'local-model'}]}));return;}
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);
  res.end(JSON.stringify({choices:[{message:body.model==='no-tools'?{content:'hello'}:{tool_calls:[{type:'function',function:{name:'connection_check',arguments:'{"ready":true}'}}]}}]}));
 });await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 try{
  process.env.AGENT_GLOBAL_STORAGE_ROOT=root;process.env.AGENT_API_KEY='synthetic-cloud-secret';delete process.env.AGENT_LOCAL_API_KEY;
  const address=server.address();assert.ok(address&&typeof address!=='string');const baseURL=`http://127.0.0.1:${address.port}/v1`;
  assert.equal((await discoverProviderModels({baseURL})).models[0].id,'local-model');
  const cfg=await validateProviderSetup({baseURL,model:'local-model'});assert.equal(cfg.apiKey,'liminal-local');
  const prefs=await persistValidatedProvider(cfg);assert.equal(prefs.provider?.model,'local-model');assert.equal(prefs.harness?.env?.AGENT_FAST_MODEL,'local-model');
  assert.equal(runHarnessEffectiveEnvContext({version:1,updatedAt:0,...prefs},()=>getFastModelSlug('local-model')),'local-model');
  await assert.rejects(validateProviderSetup({baseURL,model:'no-tools'}),/tool-call check/);
  assert.ok(headers.every(h=>h==='Bearer liminal-local'),'cloud credentials never reach the local server');
  assert.equal(process.env.AGENT_API_KEY,'synthetic-cloud-secret');
  await assert.rejects(readFile(path.join(root,'.env')));
 }finally{process.env=before;server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});}
});
test('cloud validation surfaces bad keys and malformed tool calls before persistence',async()=>{
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async()=>new Response('{}',{status:401});await assert.rejects(validateProviderSetup({baseURL:'https://openrouter.ai/api/v1',apiKey:'synthetic',model:'model'}),/credentials/);
  globalThis.fetch=async()=>new Response(JSON.stringify({choices:[{message:{tool_calls:[{function:{name:'connection_check',arguments:'oops'}}]}}]}));await assert.rejects(validateProviderSetup({baseURL:'https://openrouter.ai/api/v1',apiKey:'synthetic',model:'model'}),/tool-call check/);
  assert.equal(providerConnectionConfigured(UNCONFIGURED_PROVIDER_KEY),false);assert.equal(isLocalProviderUrl('http://127.attacker.example/v1'),false);assert.throws(()=>normalizeProviderSetup({baseURL:'http://public.example/v1'}),/HTTPS/);
 }finally{globalThis.fetch=original;}
});
test('cloud setup saves only verified credentials outside runtime preferences',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'liminal-cloud-setup-'));const original=globalThis.fetch,before={...process.env};
 try{
  process.env.AGENT_GLOBAL_STORAGE_ROOT=root;
  globalThis.fetch=async(_url,options)=>new Response(JSON.stringify(options?.method==='POST'?{choices:[{message:{tool_calls:[{function:{name:'connection_check',arguments:'{"ready":true}'}}]}}]}:{data:[{id:'cloud/tools',supported_parameters:['tools']},{id:'cloud/text',supported_parameters:[]}]}));
  const models=await discoverProviderModels({baseURL:'https://openrouter.ai/api/v1',apiKey:'synthetic-cloud'});assert.equal(models.models[0].toolCalling,true);assert.equal(models.models[1].toolCalling,false);
  const prefs=await persistValidatedProvider(await validateProviderSetup({baseURL:'https://openrouter.ai/api/v1',apiKey:'synthetic-cloud',model:'cloud/tools'}));
  assert.equal(prefs.provider?.inferenceMode,'byok');assert.ok(!JSON.stringify(prefs).includes('synthetic-cloud'));assert.match(await readFile(path.join(root,'.env'),'utf8'),/OPENROUTER_API_KEY="synthetic-cloud"/);
 }finally{globalThis.fetch=original;process.env=before;await rm(root,{recursive:true,force:true});}
});


test('verification is cached only for the exact endpoint, key and model',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'liminal-verification-'));const before={...process.env},original=globalThis.fetch;let calls=0;
 try{
  process.env.AGENT_GLOBAL_STORAGE_ROOT=root;
  const input={baseURL:'https://fixture.example/v1',apiKey:'synthetic-private-key',model:'fixture/model'};
  globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({choices:[{message:{tool_calls:[{function:{name:'connection_check',arguments:'{"ready":true}'}}]}}]}));};
  assert.equal(await providerSetupVerified(input),false);
  await ensureProviderSetupVerified(input);await ensureProviderSetupVerified(input);
  assert.equal(calls,1);assert.equal(await providerSetupVerified(input),true);
  for(const changed of [{...input,model:'other'},{...input,apiKey:'other-key'},{...input,baseURL:'https://other.example/v1'}])assert.equal(await providerSetupVerified(changed),false);
  assert.ok(!(await readFile(path.join(root,'provider_verification.json'),'utf8')).includes(input.apiKey));
  globalThis.fetch=async()=>new Response('{}',{status:401});
  const invalid={...input,apiKey:'invalid'};
  await assert.rejects(ensureProviderSetupVerified(invalid),/credentials/);assert.equal(await providerSetupVerified(invalid),false);
 }finally{process.env=before;globalThis.fetch=original;await rm(root,{recursive:true,force:true});}
});
