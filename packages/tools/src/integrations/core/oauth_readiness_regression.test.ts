import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {writeOAuthBundle} from '@liminal/core';
import {isConnectProviderOAuthReady} from './integration_oauth_start.js';

for(const outcome of ['failed','renewed','valid'] as const) test(`Google OAuth readiness requires a usable token: ${outcome}`, async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'liminal-oauth-readiness-'));
 const previous={...process.env};const originalFetch=globalThis.fetch;let requests=0;
 const keys=['AGENT_GLOBAL_STORAGE_ROOT','GOOGLE_OAUTH_CLIENT_ID','GOOGLE_OAUTH_CLIENT_SECRET'];
 try{
  process.env.AGENT_GLOBAL_STORAGE_ROOT=root;process.env.GOOGLE_OAUTH_CLIENT_ID='fixture.apps.googleusercontent.com';process.env.GOOGLE_OAUTH_CLIENT_SECRET='fixture-client-secret';
  await writeOAuthBundle({provider:'google',accountId:outcome,accessToken:'saved-access',refreshToken:'saved-refresh',scopes:[],expiresAt:Date.now()+(outcome==='valid'?3600000:-3600000),createdAt:Date.now(),updatedAt:Date.now()});
  globalThis.fetch=async()=>{requests++;return outcome==='renewed'?Response.json({access_token:'renewed-access',expires_in:3600}):Response.json({error:'invalid_grant'},{status:400});};
  assert.equal(await isConnectProviderOAuthReady('google_workspace'),outcome!=='failed','a saved expired account must not suppress requested sign-in when refresh fails');
  if(outcome==='valid')assert.equal(requests,0);
  if(outcome==='renewed')assert.ok(requests>0,'refresh before deciding sign-in is unnecessary');
 }finally{
  globalThis.fetch=originalFetch;
  for(const key of keys){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}
  assert.ok(path.resolve(root).startsWith(path.join(os.tmpdir(),'liminal-oauth-readiness-')));
  await rm(root,{recursive:true,force:true});
 }
});
