import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentHarness } from './agent.js';

test('interrupted streamed eager call is committed once, including its in-flight result', async () => {
  const env = { ...process.env };
  const root = mkdtempSync(path.join(os.tmpdir(), 'liminal-stream-retry-'));
  process.env.AGENT_GLOBAL_STORAGE_ROOT = root;
  process.env.AGENT_WORKSPACE_ROOT = root;
  process.env.AGENT_PASTE = '1';
  process.env.AGENT_API_KEY = 'synthetic-test-key';
  process.env.AGENT_INFERENCE_MODE = 'byok';
  process.env.AGENT_MEMORY_PRIME_ROUND0 = '0';
  process.env.AGENT_RECALL_EVERY_N = '0';
  const harness = new AgentHarness({ openRouterApiKey: 'synthetic-test-key', baseURL:'http://127.0.0.1:1', workspaceRoot:root, model:'fixture', maxToolRoundsPerTurn:3,
    context:{inceptionMessages:[],modelMaxTokens:32000,thresholdFraction:0.8,keepRecentRounds:4} });
  const agent = harness as any;
  let executions = 0, streams = 0;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  harness.registry.register({name:'retry_probe',description:'fixture',parameters:{type:'object',properties:{}},dangerLevel:'safe',requiresApproval:false,
    handler: async () => { executions++; await pending; return {ok:true,output:'original-result'}; }});
  harness.registry.activate(['retry_probe']);
  agent.prepareMessagesForContextLimit = async (messages: unknown) => messages;
  agent.streamWithRetry = async () => {
    if (++streams > 1) throw new Error('FIXTURE_STOP_AFTER_RETRY');
    return (async function* () {
      yield { choices: [{ index:0, delta:{tool_calls:[{index:0,id:'original-call',type:'function',function:{name:'retry_probe',arguments:'{}'}}]}, finish_reason:null }] };
      setImmediate(release);
      throw new Error('STREAM_CHUNK_TIMEOUT fixture');
    })();
  };
  try {
    await assert.rejects(agent.runReActLoop(), /FIXTURE_STOP_AFTER_RETRY/);
    assert.equal(streams, 2);
    assert.equal(executions, 1, 'retry must await the original eager dispatch');
    const messages = await agent.context.buildMessages();
    const results = messages.filter((m: any) => m.role === 'tool' && m.tool_call_id === 'original-call');
    assert.equal(results.length, 1);
    assert.equal(results[0].content, 'original-result');
  } finally {
    release();
    process.env = env;
    rmSync(root, {recursive:true,force:true});
  }
});
