import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithRetry } from './network_retry.js';
test('POST does not retry unless explicitly opted in',async()=>{
 for(const retryNonIdempotent of [false,true]){
  let calls=0;
  const response=await fetchWithRetry('https://example.invalid',{method:'POST',body:'operation'}, {timeoutMs:100,maxRetries:1,retryNonIdempotent,fetchImpl:(async()=>{calls++;return new Response('result',{status:calls===1?503:200,headers:{'retry-after':'0'}});}) as typeof fetch} as any);
  assert.equal(calls,retryNonIdempotent?2:1);assert.equal(await response.text(),'result');
 }
});
