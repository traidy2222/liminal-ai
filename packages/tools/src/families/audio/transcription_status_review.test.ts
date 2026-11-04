import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentHarness } from "@liminal/core";
import { LocalTranscriptionClient, closeLocalTranscription } from "../../../../core/dist/local_transcription.js";
import { createTranscribeAudioTool } from "./transcribe_audio.js";

test("a successful local transcription reports a known zero API cost", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "asr-cost-review-"));
  const previous = process.env["LIMINAL_LOCAL_ASR_HOME"]; process.env["LIMINAL_LOCAL_ASR_HOME"] = root;
  const manifest = JSON.parse(await readFile(new URL("../../../../core/local-asr/manifest.json", import.meta.url), "utf8"));
  const python = path.join(root, "whisper", ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  await mkdir(path.dirname(python), { recursive: true }); await writeFile(python, "");
  await writeFile(path.join(root, "whisper", "ready.json"), JSON.stringify({ runtimeVersion: manifest.runtimeVersion, revision: manifest.profiles.whisper.baseRevision }));
  const audio = path.join(root, "sample.wav"); await writeFile(audio, Buffer.alloc(44));
  t.mock.method(LocalTranscriptionClient.prototype, "transcribe", async () => ({ text: "Hello", noSpeech: false, durationSec: 1 }));
  const harness = { taskId: "cost-review", getRuntimePreferences: () => ({ version: 1, updatedAt: 0, harness: { env: { AGENT_TRANSCRIBE_ENABLED: "1", AGENT_TRANSCRIBE_MODEL: "local/whisper-large-v3-turbo" } } }) } as unknown as AgentHarness;
  const emitted: string[] = [];
  try {
    const result = await createTranscribeAudioTool(harness).handler({ path: audio }, message => { emitted.push(message); });
    assert.equal(result.ok, true); assert.match(emitted.at(-1)!, /\$0\.00000/); assert.doesNotMatch(emitted.at(-1)!, /unknown/);
  } finally {
    closeLocalTranscription(); if (previous === undefined) delete process.env["LIMINAL_LOCAL_ASR_HOME"]; else process.env["LIMINAL_LOCAL_ASR_HOME"] = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("an unregistered cloud model retains unknown-cost status", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "asr-cloud-cost-review-"));
  const previousKey = process.env["AGENT_TRANSCRIBE_API_KEY"];
  process.env["AGENT_TRANSCRIBE_API_KEY"] = "fixture-key";
  t.mock.method(globalThis, "fetch", async () => Response.json({ text: "Cloud result", duration: 1 }));
  const audio = path.join(root, "sample.wav"); await writeFile(audio, Buffer.alloc(44));
  const harness = { taskId: "cloud-cost-review", getRuntimePreferences: () => ({ version: 1, updatedAt: 0, harness: { env: {
    AGENT_SINGLE_MODEL: "0", AGENT_TRANSCRIBE_ENABLED: "1", AGENT_TRANSCRIBE_MODEL: "custom/cloud", AGENT_TRANSCRIBE_BASE_URL: "https://api.openai.com/v1",
  } } }) } as unknown as AgentHarness;
  const emitted: string[] = [];
  try {
    assert.equal((await createTranscribeAudioTool(harness).handler({ path: audio }, message => { emitted.push(message); })).ok, true);
    assert.match(emitted.at(-1)!, /cost unknown/);
  } finally {
    if (previousKey === undefined) delete process.env["AGENT_TRANSCRIBE_API_KEY"]; else process.env["AGENT_TRANSCRIBE_API_KEY"] = previousKey;
    await rm(root, { recursive: true, force: true });
  }
});
