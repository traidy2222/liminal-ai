import test from 'node:test';
import assert from 'node:assert/strict';
import { runHarnessEffectiveEnvContext } from './harness_effective_env.js';
import { resolveProviderMinIntervalMs } from './provider_request_gate.js';
test('Kimchi spacing honors active session preferences',()=>{
 const old=process.env.AGENT_PROVIDER_MIN_INTERVAL_MS, k=process.env.AGENT_KIMCHI_MIN_INTERVAL_MS;
 try{delete process.env.AGENT_PROVIDER_MIN_INTERVAL_MS;delete process.env.AGENT_KIMCHI_MIN_INTERVAL_MS;
 runHarnessEffectiveEnvContext({harness:{env:{AGENT_KIMCHI_MIN_INTERVAL_MS:'4321'}}} as any,()=>assert.equal(resolveProviderMinIntervalMs('https://llm.cast.ai/v1'),4321));
 }finally{if(old===undefined)delete process.env.AGENT_PROVIDER_MIN_INTERVAL_MS;else process.env.AGENT_PROVIDER_MIN_INTERVAL_MS=old;if(k===undefined)delete process.env.AGENT_KIMCHI_MIN_INTERVAL_MS;else process.env.AGENT_KIMCHI_MIN_INTERVAL_MS=k;}
});
