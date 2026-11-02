import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithRetry } from './network_retry.js';
test('aborted request signal never retries',async()=>{
 const ac=new AbortController();let calls=0;
 const fetchImpl=(async()=>{calls++;ac.abort();throw new DOMException('aborted','AbortError');}) as typeof fetch;
 await assert.rejects(fetchWithRetry('https://example.invalid',{signal:ac.signal},{timeoutMs:100,maxRetries:2,maxDelayMs:1000,fetchImpl}),{name:'AbortError'});
 assert.equal(calls,1);
});
