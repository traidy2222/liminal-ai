import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {refreshOAuthViaVireonHostedBroker} from './hosted_oauth_refresh.js';

test('an expired optional Liminal license does not block credential-authenticated OAuth refresh', async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'liminal-oauth-license-'));
 const env={...process.env};const originalFetch=globalThis.fetch;let requests=0;
 try{
  process.env.AGENT_GLOBAL_STORAGE_ROOT=root;
  process.env.AGENT_LICENSE_KEY='expired-license-fixture';process.env.AGENT_LICENSE_PREFER_ENV='1';
  globalThis.fetch=async(_url,init)=>{
   requests++;
   const headers=new Headers(init?.headers);
   assert.deepEqual(JSON.parse(String(init?.body)),{provider:'google',refresh_token:'existing-provider-refresh-token'});
   return headers.has('Authorization')
    ? Response.json({error:'Invalid or expired license'},{status:403})
    : Response.json({access_token:'renewed-provider-access-token',expires_at:Date.now()+3600000});
  };
  const result=await refreshOAuthViaVireonHostedBroker('google','existing-provider-refresh-token');
  assert.ok(result,'the refresh-token credential must work independently of optional license state');
  assert.equal(result.accessToken,'renewed-provider-access-token');
  assert.equal(result.refreshToken,'existing-provider-refresh-token');
  assert.equal(requests,1);
 }finally{
  globalThis.fetch=originalFetch;
  for(const key of ['AGENT_GLOBAL_STORAGE_ROOT','AGENT_LICENSE_KEY','AGENT_LICENSE_PREFER_ENV']){if(env[key]===undefined)delete process.env[key];else process.env[key]=env[key];}
  assert.ok(path.resolve(root).startsWith(path.join(os.tmpdir(),'liminal-oauth-license-')));
  await rm(root,{recursive:true,force:true});
 }
});
