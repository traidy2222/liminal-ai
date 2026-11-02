import test from 'node:test';
import assert from 'node:assert/strict';
import type OpenAI from 'openai';
import { SafetyJudge } from './safety_judge.js';
const client = { chat: { completions: { create: async () => ({ choices: [{ message: { content: '0' } }] }) } } } as unknown as OpenAI;
for (const command of ['git status; printf bad', 'git status && printf bad', 'git status\nprintf bad', 'echo $(printf bad)', 'echo `whoami`', 'git diff > output', 'git branch -D important', 'git log --output=output']) {
  test(`shell approval is required for ${JSON.stringify(command)}`, async () => {
    assert.equal((await new SafetyJudge(client, { model: 'test' }).classify('run_shell', { command })).verdict, 'require_human');
  });
}
test('plain git status remains locally classifiable', async () => {
  assert.equal((await new SafetyJudge(client, { model: 'test' }).classify('run_shell', { command: 'git status' })).verdict, 'safe');
});
