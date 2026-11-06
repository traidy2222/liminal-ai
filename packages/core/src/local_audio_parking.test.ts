import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { LocalSpeechClient } from "./local_speech.js";
import { LocalTranscriptionClient } from "./local_transcription.js";

const voiceWorker = fileURLToPath(new URL("./fixtures/local_speech_worker.mjs", import.meta.url));
test("speech parking acknowledges GPU release and reuses the same worker for the next reply", async () => {
  const client = new LocalSpeechClient(process.execPath, [voiceWorker]);
  try {
    await client.warmup();
    const first = Buffer.from(await client.synthesize("first", 5000)).readUInt32LE(44);
    await client.releaseGpu();
    const next = Buffer.from(await client.synthesize("next", 5000)).readUInt32LE(44);
    assert.equal(next, first);
  } finally { await client.closeAndWait(); }
});
test("unacknowledged voice parking waits for process exit and starts a fresh worker", async () => {
  const client = new LocalSpeechClient(process.execPath, [voiceWorker, "--bad-release"]);
  try {
    const first = Buffer.from(await client.synthesize("first", 5000)).readUInt32LE(44);
    await client.releaseGpu();
    const next = Buffer.from(await client.synthesize("next", 5000)).readUInt32LE(44);
    assert.notEqual(next, first);
  } finally { await client.closeAndWait(); }
});
test("transcription parking preserves the loaded worker across TTS handoffs", async () => {
  const client = new LocalTranscriptionClient(process.execPath,
    [fileURLToPath(new URL("./fixtures/local_transcription_worker.mjs", import.meta.url))]);
  try {
    await client.transcribe({ op: "warmup" }, 5000);
    await client.releaseGpu();
    assert.equal((await client.transcribe({ audio: "ready again" }, 5000)).text, "ready again");
  } finally { await client.closeAndWait(); }
});
