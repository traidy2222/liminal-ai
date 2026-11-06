import test from "node:test";
import assert from "node:assert/strict";
import { resolveWakeVoiceConfig } from "./wake_voice.js";
import { warmupConfiguredTranscription } from "./transcription_warmup.js";
import type { RuntimePreferences } from "./runtime_prefs.js";

const prefs = (env: Record<string, string>): RuntimePreferences => ({ version: 1, updatedAt: 0, harness: { env } });
test("wake settings are opt-in, bounded and preserve configurable phrases", () => {
  assert.deepEqual(resolveWakeVoiceConfig(null), { enabled: false, phrase: "Hey Jarvis", idleTimeoutMs: 45000 });
  assert.deepEqual(resolveWakeVoiceConfig(prefs({ AGENT_WAKE_WORD_ENABLED: "1", AGENT_WAKE_WORD_PHRASE: "  Okay   Liminal ", AGENT_WAKE_WORD_IDLE_SECONDS: "60" })),
    { enabled: true, phrase: "Okay Liminal", idleTimeoutMs: 60000 });
  assert.equal(resolveWakeVoiceConfig(prefs({ AGENT_WAKE_WORD_PHRASE: "???", AGENT_WAKE_WORD_IDLE_SECONDS: "-1" })).phrase, "Hey Jarvis");
  assert.equal(resolveWakeVoiceConfig(prefs({ AGENT_WAKE_WORD_IDLE_SECONDS: "100000" })).idleTimeoutMs, 300000);
});
test("wake-enabled startup warms local Whisper even when manual dictation selects Qwen", async () => {
  const calls: string[] = [];
  const ok = await warmupConfiguredTranscription(prefs({ AGENT_WAKE_WORD_ENABLED: "1", AGENT_TRANSCRIBE_MODEL: "local/qwen3-asr-1.7b" }),
    async (model) => { calls.push(model); });
  assert.equal(ok, true);
  assert.deepEqual(calls, ["local/whisper-large-v3-turbo"]);
});

test("wake mode preloads only an explicitly enabled local voice, without waiting for its CPU load", async () => {
  let speechCalls = 0;
  let release!: () => void;
  const loading = new Promise<void>(r => { release = r; });
  const config = prefs({ AGENT_WAKE_WORD_ENABLED: "1", AGENT_TTS_ENABLED: "1", AGENT_TTS_MODEL: "local/jarvis-warm" });
  try {
    assert.equal(await warmupConfiguredTranscription(config, async () => {}, async () => { speechCalls++; await loading; }), true);
    assert.equal(speechCalls, 1);
    await warmupConfiguredTranscription(prefs({ AGENT_WAKE_WORD_ENABLED: "1", AGENT_TTS_ENABLED: "1", AGENT_TTS_MODEL: "hexgrad/kokoro-82m" }), async () => {}, async () => { speechCalls++; });
    assert.equal(speechCalls, 1, "never preload a cloud speech model");
  } finally { release(); }
});
