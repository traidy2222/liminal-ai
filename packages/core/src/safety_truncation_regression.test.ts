import test from 'node:test';
import assert from 'node:assert/strict';
import type OpenAI from 'openai';
import { SafetyJudge } from './safety_judge.js';
test('oversized classifier input cannot be approved from a truncated prefix', async () => {
  let calls = 0;
  const client = { chat: { completions: { create: async () => { calls++; return { choices: [{ message: { content: '0' } }] }; } } } } as unknown as OpenAI;
  const args = { payload: 'x'.repeat(1600), action: 'delete' };
  assert.equal((await new SafetyJudge(client, { model: 'test' }).classify('custom_tool', args)).verdict, 'require_human');
  assert.equal(calls, 0);
  assert.equal((await new SafetyJudge(client, { model: 'test', failOpen: true }).classify('custom_tool', args)).verdict, 'safe');
});
