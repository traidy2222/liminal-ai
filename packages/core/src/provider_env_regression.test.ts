import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveProviderConfig } from './provider_config.js';
test('resolving another provider does not erase the process credential',()=>{
 const old=process.env.AGENT_API_KEY, kimchi=process.env.KIMCHI_API_KEY;
 try {process.env.AGENT_API_KEY='synthetic-openrouter-key';process.env.KIMCHI_API_KEY='castai_v1_synthetic';
 resolveProviderConfig({baseURL:'https://llm.cast.ai/v1'});
 assert.equal(process.env.AGENT_API_KEY,'synthetic-openrouter-key');
 } finally {if(old===undefined)delete process.env.AGENT_API_KEY;else process.env.AGENT_API_KEY=old;if(kimchi===undefined)delete process.env.KIMCHI_API_KEY;else process.env.KIMCHI_API_KEY=kimchi;}
});
