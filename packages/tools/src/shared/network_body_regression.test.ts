import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithRetry } from './network_retry.js';
test('final retryable response retains its body',async()=>{
 const response=await fetchWithRetry('https://example.invalid',{}, {timeoutMs:100,maxRetries:0,fetchImpl:(async()=>new Response('service unavailable',{status:503})) as typeof fetch});
 assert.equal(await response.text(),'service unavailable');
});
