import test from 'node:test';
import assert from 'node:assert/strict';
import { SafetyJudge } from './safety_judge.js';
import { withProviderRequestSpacing } from './provider_request_gate.js';
test('classifier request timeout begins after provider queue admission',async()=>{
 const old=process.env.AGENT_PROVIDER_MIN_INTERVAL_MS;process.env.AGENT_PROVIDER_MIN_INTERVAL_MS='80';
 const client:any={apiKey:'synthetic-safety-queue',baseURL:'https://fixture.invalid',chat:{completions:{create:async(_body:any,{signal}:any)=>{
  signal.throwIfAborted();return {choices:[{message:{content:'0'}}]};
 }}}};
 try {
  await withProviderRequestSpacing(client,async()=>undefined);
  const judge=new SafetyJudge(client,{model:'fixture',timeoutMs:10});
  const result=await judge.classify('unknown_fixture',{operation:'test'});
  assert.equal(result.verdict,'safe');assert.equal(result.source,'llm');
 }finally{if(old===undefined)delete process.env.AGENT_PROVIDER_MIN_INTERVAL_MS;else process.env.AGENT_PROVIDER_MIN_INTERVAL_MS=old;}
});
