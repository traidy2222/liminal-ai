import test from 'node:test';
import assert from 'node:assert/strict';
import {VoiceTextStream} from './voice_text_stream.js';
import {AgentHarness} from './agent.js';
import {AgentEmitter} from './events.js';
import {inferTurnInference} from './intent_inference.js';

test('interactive voice does not wait for a remote classifier or remove delegation tools', async () => {
  let calls = 0;
  const client = {chat: {completions: {create() {calls++; throw Error('unexpected classifier request');}}}} as any;
  const result = await inferTurnInference(client, 'main', 'Explain why the sky changes colour in the evening', undefined, {interactiveVoice: true});
  assert.equal(calls, 0);
  assert.equal(result.intent, 'execution');
  assert.equal(result.skipHarnessSecondaryPasses, true);
});

test('turn admission becomes idle without waiting for streamed speech to finish', async () => {
  let release!: () => void;
  const blocked = new Promise<void>(r => {release = r;});
  const emitter = new AgentEmitter(); let ended = false;
  emitter.on('turn_end', () => {ended = true;});
  const harness = Object.assign(Object.create(AgentHarness.prototype), {
    context: {getEpistemicState: () => null, getLastAssistantMessage: () => 'A useful answer.'},
    emitter, liveDictationThisSend: true, toolsUsedThisTurn: [], sendStartTime: Date.now(),
    buildUiContextSnapshot: () => ({}), buildHarnessMetrics: () => ({}),
    voiceTtsStream: {finish: () => blocked},
  }) as any;
  harness.emitTurnEnd('ok');
  assert.equal(ended, true, 'audio generation must not gate the terminal event');
  release(); await blocked;
});

test('stale voice cancellation cannot cancel a new reply or the running agent', () => {
  let cancelled = false;
  const agent = new AbortController(), voice = new AbortController();
  const harness = Object.assign(Object.create(AgentHarness.prototype), {
    currentTurnController: agent, voiceTtsController: voice,
    voiceTtsStream: {id: 'new', cancel: () => {cancelled = true;}},
  }) as AgentHarness;
  harness.cancelVoiceSpeech('old'); assert.equal(cancelled, false);
  harness.cancelVoiceSpeech('new');
  assert.equal(cancelled, true); assert.equal(voice.signal.aborted, true);
  assert.equal(agent.signal.aborted, false);
});

test('first sentence starts synthesis before the model finishes, preserving order under backpressure', async () => {
  const spoken: string[] = [];
  let release!: () => void;
  const blocked = new Promise<void>(r => {release = r;});
  const stream = new VoiceTextStream(async text => {spoken.push(text); if (spoken.length === 1) await blocked;}, assert.fail);
  stream.push('The background workers are still running. ');
  await new Promise(r => setImmediate(r));
  assert.deepEqual(spoken, ['The background workers are still running.']);
  stream.push('You can keep talking while they work.');
  const finished = stream.finish();
  assert.equal(spoken.length, 1);
  release(); await finished;
  assert.deepEqual(spoken, ['The background workers are still running.', 'You can keep talking while they work.']);
});

test('a fast opening is followed by a cohesive continuation, without standalone acknowledgements', async () => {
  const spoken: string[] = [];
  const stream = new VoiceTextStream(async text => {spoken.push(text);}, assert.fail);
  stream.push('Yes.');
  await new Promise(r => setTimeout(r, 90));
  assert.equal(spoken.length, 0, 'do not turn a brief acknowledgement into a detached clip');
  stream.push(' The workers are handling that now. ');
  await new Promise(r => setImmediate(r));
  assert.deepEqual(spoken, ['Yes. The workers are handling that now.']);
  stream.push('You can keep talking. I will report their results.');
  await stream.finish();
  assert.equal(spoken[1], 'You can keep talking. I will report their results.');
});

test('cancellation stops active synthesis and drops queued sentences', async () => {
  const spoken: string[] = [];
  let cancelled = false;
  const stream = new VoiceTextStream(async (text, signal) => {
    spoken.push(text);
    await new Promise<void>(r => signal.addEventListener('abort', () => {cancelled = true; r();}, {once: true}));
  }, assert.fail);
  stream.push('This is the first complete sentence. Another complete sentence follows. ');
  await new Promise(r => setImmediate(r));
  stream.cancel(); await stream.finish();
  assert.equal(cancelled, true); assert.equal(spoken.length, 1);
});

test('code fences split across provider deltas are never read aloud', async () => {
  const spoken: string[] = [];
  const stream = new VoiceTextStream(async text => {spoken.push(text);}, assert.fail);
  for (const delta of ['Here is the explanation. ', '``', '`js\n', 'dangerous.code();\n', '`', '``', '\nThe result is ready.']) stream.push(delta);
  await stream.finish();
  assert.deepEqual(spoken, ['Here is the explanation.', 'The result is ready.']);
});

test('long unpunctuated answers are bounded and speech failures do not cause duplicate retries', async () => {
  const calls: string[] = [], errors: unknown[] = [];
  const stream = new VoiceTextStream(async text => {calls.push(text); throw Error('decoder failed');}, e => errors.push(e), 400);
  stream.push('a fairly long clause with natural word boundaries '.repeat(30));
  await stream.finish();
  assert.equal(calls.length, 1); assert.equal(errors.length, 1);
  assert.ok(calls[0]!.length <= 160);
});
