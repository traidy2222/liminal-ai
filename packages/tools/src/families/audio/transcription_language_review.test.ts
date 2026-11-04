import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { LocalTranscriptionClient, closeLocalTranscription } from "../../../../core/dist/local_transcription.js";
import { wrapPcm16LeMonoAsWav } from "@liminal/core";
import { handleTranscribe } from "./audio_http_handlers.js";

test("blank and non-string preview languages preserve the configured language", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "asr-language-"));
  const previous = process.env["LIMINAL_LOCAL_ASR_HOME"];
  process.env["LIMINAL_LOCAL_ASR_HOME"] = root;
  const manifest = JSON.parse(await readFile(new URL("../../../../core/local-asr/manifest.json", import.meta.url), "utf8"));
  const python = path.join(root, "whisper", ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  await mkdir(path.dirname(python), { recursive: true }); await writeFile(python, "");
  await writeFile(path.join(root, "whisper", "ready.json"), JSON.stringify({ runtimeVersion: manifest.runtimeVersion, revision: manifest.profiles.whisper.baseRevision }));
  const languages: unknown[] = [];
  t.mock.method(LocalTranscriptionClient.prototype, "transcribe", async (payload: Record<string, unknown>) => {
    languages.push(payload.language); return { text: "नमस्ते", language: payload.language, noSpeech: false, durationSec: 1 };
  });
  const bridge = { chatId: "language-review", getRuntimePreferences: () => ({ version: 1 as const, updatedAt: 0, harness: { env: { AGENT_TRANSCRIBE_ENABLED: "1", AGENT_TRANSCRIBE_LANGUAGE: "hi", AGENT_TRANSCRIBE_MODEL: "local/whisper-large-v3-turbo" } } }) };
  const previewWav = Buffer.from(wrapPcm16LeMonoAsWav(new Uint8Array(32000), 16000)).toString("base64");
  try {
    for (const language of ["", "   ", 42, { language: "en" }]) await handleTranscribe(bridge, { previewWav, language: language as string });
    assert.deepEqual(languages, ["hi", "hi", "hi", "hi"]);
  } finally {
    closeLocalTranscription();
    if (previous === undefined) delete process.env["LIMINAL_LOCAL_ASR_HOME"]; else process.env["LIMINAL_LOCAL_ASR_HOME"] = previous;
    await rm(root, { recursive: true, force: true });
  }
});
