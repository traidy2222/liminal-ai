import test from 'node:test';
import assert from 'node:assert/strict';
import type OpenAI from 'openai';
import {inferTurnInference,resolveMemoryPolicy} from './intent_inference.js';
import {runHarnessEffectiveEnvContext} from './harness_effective_env.js';
import {InferenceLatencyTracker} from './inference_latency.js';
test('default routing handles knowledge, greetings and code without a classifier request',async()=>{
 const prev=process.env.AGENT_INTENT_INFERENCE; delete process.env.AGENT_INTENT_INFERENCE;
 let calls=0;
 const client={chat:{completions:{create:async()=>{calls++;throw Error('Unexpected classifier request');}}}} as unknown as OpenAI;
 try { await runHarnessEffectiveEnvContext(null,async()=>{
  const greeting=await inferTurnInference(client,'test/model','hello');
  assert.equal(greeting.intent,'conversational');
  assert.equal(resolveMemoryPolicy(greeting).allowAutoRecall,false);
  const coding=await inferTurnInference(client,'test/model','read `src/a.ts` and edit_file to fix the bug');
  assert.equal(coding.intent,'coding');
  const knowledge=await inferTurnInference(client,'test/model','Explain how connection pooling works in PostgreSQL.');
  assert.equal(knowledge.source,'default'); assert.equal(calls,0);
 }); }finally{if(prev===undefined)delete process.env.AGENT_INTENT_INFERENCE;else process.env.AGENT_INTENT_INFERENCE=prev;}
});
test('latency distinguishes preparation and answer text from earlier reasoning',()=>{
 const previous=Date.now;let now=1000;Date.now=()=>now;
 try {const t=new InferenceLatencyTracker('test','trace',800);t.markRequestStart();now=1100;t.markFirstToken();now=1400;t.markFirstText();now=1500;t.markFirstText();const e=t.markCompletion();assert.equal(e.preRequestMs,200);assert.equal(e.ttftMs,100);assert.equal(e.firstTextMs,1400);assert.equal(e.turnToFirstTextMs,600);}finally{Date.now=previous;}
});
