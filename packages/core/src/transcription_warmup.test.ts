import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { LocalTranscriptionClient } from "./local_transcription.js";
import { warmupConfiguredTranscription } from "./transcription_warmup.js";
import type { RuntimePreferences } from "./runtime_prefs.js";

test("startup warmup selects the local mode only, without keys or provider requests", async () => {
  const calls: string[] = [];
  const warmup = async (model: string) => { calls.push(model); };
  const prefs = (enabled: string, model: string): RuntimePreferences => ({ version: 1, updatedAt: 0,
    harness: { env: { AGENT_TRANSCRIBE_ENABLED: enabled, AGENT_TRANSCRIBE_MODEL: model } } });
  assert.equal(await warmupConfiguredTranscription(prefs("1", "local/whisper-large-v3-turbo"), warmup), true);
  assert.equal(await warmupConfiguredTranscription(prefs("1", "local/qwen3-asr-1.7b"), warmup), true);
  assert.equal(await warmupConfiguredTranscription(prefs("0", "local/whisper-large-v3-turbo"), warmup), false);
  assert.equal(await warmupConfiguredTranscription(prefs("1", "openai/whisper-1"), warmup), false);
  assert.equal(await warmupConfiguredTranscription(prefs("1", "local/whisper-large-v3-turbo"), async () => { throw Error("not installed"); }), false);
  assert.deepEqual(calls, ["local/whisper-large-v3-turbo", "local/qwen3-asr-1.7b"]);
});

test("a decoder retained for wake listening survives two-minute idle eviction", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const keepAlive = setInterval(() => {}, 1000);
  let starts = 0;
  const client = new LocalTranscriptionClient(process.execPath,
    [fileURLToPath(new URL("./fixtures/local_transcription_worker.mjs", import.meta.url))],
    (command, args) => { starts++; return spawn(command, args, { stdio: "pipe", windowsHide: true }); });
  try {
    client.setKeepWarm(true);
    assert.equal((await client.transcribe({ op: "warmup" }, 5000)).noSpeech, true);
    t.mock.timers.tick(120_001);
    assert.equal((await client.transcribe({ audio: "ready immediately" }, 5000)).text, "ready immediately");
    assert.equal(starts, 1);
  } finally { client.close(); clearInterval(keepAlive); }
});

test("ordinary warmup and disabling wake listening both allow idle reclamation", { timeout: 5000 }, async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const keepAlive = setInterval(() => {}, 1000);
  let starts = 0;
  const children: ReturnType<typeof spawn>[] = [];
  const client = new LocalTranscriptionClient(process.execPath,
    [fileURLToPath(new URL("./fixtures/local_transcription_worker.mjs", import.meta.url))],
    (command, args) => { starts++; const child = spawn(command, args, { stdio: "pipe", windowsHide: true }); children.push(child); return child; });
  try {
    await client.transcribe({ op: "warmup" }, 5000);
    const firstExit = once(children[0]!, "close");
    t.mock.timers.tick(120_001);
    await firstExit;
    await client.transcribe({ audio: "dictation resumes" }, 5000);
    assert.equal(starts, 2);
    client.setKeepWarm(true);
    await client.transcribe({ op: "warmup" }, 5000);
    client.setKeepWarm(false);
    const secondExit = once(children[1]!, "close");
    t.mock.timers.tick(120_001);
    await secondExit;
    assert.equal((await client.transcribe({ audio: "voice resumes again" }, 5000)).text, "voice resumes again");
    assert.equal(starts, 3);
  } finally { client.close(); clearInterval(keepAlive); }
});
