import test from "node:test";
import assert from "node:assert/strict";
import { resolveTranscriptionConfig } from "./transcription.js";
test("uppercase legacy Parakeet migrates to enabled local Whisper in single-model mode", () => {
  const config = resolveTranscriptionConfig({ version: 1, updatedAt: 0, harness: { env: {
    AGENT_SINGLE_MODEL: "1", AGENT_TRANSCRIBE_ENABLED: "1", AGENT_TRANSCRIBE_MODEL: " NVIDIA/PARAKEET-TDT-0.6B-V3 ",
  } } });
  assert.equal(config.model, "local/whisper-large-v3-turbo"); assert.equal(config.enabled, true);
});
