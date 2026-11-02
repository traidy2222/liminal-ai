import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithRetry } from './network_retry.js';
test('invalid numeric retry configuration retains a usable default',async()=>{
 let calls=0;
 const response=await fetchWithRetry('https://example.invalid',{}, {timeoutMs:100,maxRetries:NaN,maxDelayMs:NaN,fetchImpl:(async()=>{calls++;return new Response('ok');}) as typeof fetch});
 assert.equal(calls,1);assert.equal(await response.text(),'ok');
});
