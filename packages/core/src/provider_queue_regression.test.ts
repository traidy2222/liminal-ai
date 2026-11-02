import test from 'node:test';
import assert from 'node:assert/strict';
import { withProviderRequestSpacing } from './provider_request_gate.js';
import { runHarnessEffectiveEnvContext } from './harness_effective_env.js';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
test('provider start spacing allows nested calls and does not wait for response completion', async () => {
 await runHarnessEffectiveEnvContext({harness:{env:{AGENT_PROVIDER_MIN_INTERVAL_MS:'10'}}} as any, async () => {
  const creds={apiKey:'queue-regression',baseURL:'https://example.invalid'};
  let release!:()=>void;
  const stalled=withProviderRequestSpacing(creds,()=>new Promise<void>(r=>{release=r;}));
  await delay(20);
  let completed=false;
  const nested=withProviderRequestSpacing(creds,()=>withProviderRequestSpacing(creds,async()=>{completed=true;}));
  await delay(150);
  const progressed=completed;
  release();
  await stalled;
  // Do not await a deadlocked nested call in the failing implementation.
  assert.ok(progressed,'a stalled response must not block later request starts or same-key nesting');
  await nested;
 });
});
test('aborting a queued provider request rejects promptly and never invokes its callback', async () => {
 await runHarnessEffectiveEnvContext({harness:{env:{AGENT_PROVIDER_MIN_INTERVAL_MS:'400'}}} as any, async () => {
  const creds={apiKey:'abort-regression',baseURL:'https://example.invalid'};
  await withProviderRequestSpacing(creds,async()=>{});
  const controller=new AbortController(); let invoked=false;
  const queued=(withProviderRequestSpacing as any)(creds,async()=>{invoked=true;},controller.signal);
  let rejected=false;
  const settled=queued.then(()=>{},()=>{rejected=true;});
  controller.abort(); await delay(30);
  const prompt=rejected; await settled;
  assert.ok(prompt,'queue cancellation must return before the reserved interval');
  assert.equal(invoked,false);
 });
});
