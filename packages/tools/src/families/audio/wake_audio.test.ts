import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { wrapPcm16LeMonoAsWav, type RuntimePreferences } from "@liminal/core";
import { handleTranscribe } from "./audio_http_handlers.js";

test("wake PCM never resolves cloud credentials, falls back remotely, or creates an attachment", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "liminal-wake-audio-"));
  const oldHome = process.env.LIMINAL_LOCAL_ASR_HOME, oldRoot = process.env.AGENT_GLOBAL_STORAGE_ROOT, oldFetch = globalThis.fetch;
  process.env.LIMINAL_LOCAL_ASR_HOME = path.join(root, "not-installed");
  process.env.AGENT_GLOBAL_STORAGE_ROOT = root;
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error("Unexpected external call"); };
  const prefs: RuntimePreferences = { version: 1, updatedAt: 0, harness: { env: {
    AGENT_TRANSCRIBE_MODEL: "openai/whisper-1", AGENT_SINGLE_MODEL: "0", AGENT_TRANSCRIBE_ENABLED: "1",
  } } };
  const bridge = { chatId: "wake-test", getRuntimePreferences: () => prefs };
  try {
    const wakeWav = Buffer.from(wrapPcm16LeMonoAsWav(new Uint8Array(32000), 16000)).toString("base64");
    await assert.rejects(handleTranscribe(bridge, { wakeWav, model: "openai/whisper-1" }), /Install local transcription first/);
    assert.equal(requests, 0);
    assert.deepEqual(await readdir(root), []);
    assert.equal((await handleTranscribe(bridge, { wakeWav: Buffer.from("not WAV").toString("base64") })).status, 400);
    assert.equal((await handleTranscribe(bridge, { wakeWav: "a".repeat(2_800_000) })).status, 413);
    const cappedTake = Buffer.from(wrapPcm16LeMonoAsWav(new Uint8Array(1_936_000), 16000)).toString("base64");
    await assert.rejects(handleTranscribe(bridge, { wakeWav: cappedTake }), /Install local transcription first/);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldHome === undefined) delete process.env.LIMINAL_LOCAL_ASR_HOME; else process.env.LIMINAL_LOCAL_ASR_HOME = oldHome;
    if (oldRoot === undefined) delete process.env.AGENT_GLOBAL_STORAGE_ROOT; else process.env.AGENT_GLOBAL_STORAGE_ROOT = oldRoot;
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("liminal-wake-audio-"));
    await rm(root, { recursive: true, force: true });
  }
});
