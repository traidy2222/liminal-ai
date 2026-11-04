import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { LocalTranscriptionClient } from "./local_transcription.js";
import { transcribeAudio, resolveTranscriptionConfigAsync } from "./transcription.js";
import type { RuntimePreferences } from "./runtime_prefs.js";

const worker = () => new LocalTranscriptionClient(process.execPath, [fileURLToPath(new URL("./fixtures/local_transcription_worker.mjs", import.meta.url))]);
test("transcription worker serializes requests, preserves Unicode, and returns explicit no-speech", async () => {
  const client = worker();
  try {
    const results = await Promise.all([client.transcribe({ audio: "नमस्ते 世界" }, 5000), client.transcribe({ audio: "" }, 5000)]);
    assert.equal(results[0]!.text, "नमस्ते 世界"); assert.equal(results[1]!.noSpeech, true);
  } finally { client.close(); }
});
test("transcription timeout, abort, and decoder crashes recover without killing the daemon", async () => {
  const client = worker();
  try {
    await assert.rejects(client.transcribe({ audio: "hang" }, 300), /timed out/);
    assert.equal((await client.transcribe({ audio: "recovered" }, 5000)).text, "recovered");
    const controller = new AbortController();
    const pending = client.transcribe({ audio: "hang" }, 5000, controller.signal);
    setTimeout(() => controller.abort(), 100);
    await assert.rejects(pending, /cancelled/);
    await assert.rejects(client.transcribe({ audio: "invalid" }, 5000));
    await assert.rejects(client.transcribe({ audio: "crash" }, 5000), /stopped unexpectedly/);
    assert.equal((await client.transcribe({ audio: "again" }, 5000)).text, "again");
  } finally { client.close(); }
});
test("local ASR requires no provider key, bypasses managed routing, and never falls back to cloud", async () => {
  const prefs: RuntimePreferences = { version: 1, updatedAt: 0, harness: { env: {
    AGENT_SINGLE_MODEL: "1", AGENT_TRANSCRIBE_ENABLED: "1", AGENT_TRANSCRIBE_MODEL: "local/whisper-large-v3-turbo", AGENT_TRANSCRIBE_LANGUAGE: "hi",
  } } };
  const old = process.env["LIMINAL_LOCAL_ASR_HOME"], originalFetch = globalThis.fetch;
  process.env["LIMINAL_LOCAL_ASR_HOME"] = fileURLToPath(new URL("./fixtures/no-asr-installed", import.meta.url));
  globalThis.fetch = async () => { throw new Error("Unexpected network request"); };
  try {
    const config = await resolveTranscriptionConfigAsync(prefs);
    assert.equal(config.enabled, true); assert.equal(config.apiKey, ""); assert.equal(config.language, "hi");
    await assert.rejects(transcribeAudio({ audio: Buffer.alloc(44), filename: "test.wav" }, config), /Install local transcription first/);
    await assert.rejects(transcribeAudio({ audio: Buffer.alloc(44), filename: "test.wav", model: "LOCAL/unknown" }, config), /Unknown local transcription model/);
    await assert.rejects(transcribeAudio({ audio: Buffer.alloc(45), filename: "test.wav" }, { ...config, maxBytes: 44 }), /exceeds/);
  } finally {
    globalThis.fetch = originalFetch;
    if (old === undefined) delete process.env["LIMINAL_LOCAL_ASR_HOME"]; else process.env["LIMINAL_LOCAL_ASR_HOME"] = old;
  }
});
