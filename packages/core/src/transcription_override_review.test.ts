import test from "node:test";
import assert from "node:assert/strict";
import { resolveTranscriptionConfig, transcribeAudio } from "./transcription.js";

test("a local configuration rejects cloud overrides with an explicit routing instruction", async () => {
  const config = { ...resolveTranscriptionConfig(null), enabled: true, model: "local/whisper-large-v3-turbo", apiKey: "" };
  await assert.rejects(transcribeAudio({ audio: Buffer.alloc(44), filename: "test.wav", model: "openai/whisper-large-v3-turbo" }, config), /select.*cloud.*(?:Settings|configuration)/i);
});
