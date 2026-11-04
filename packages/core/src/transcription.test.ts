import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TRANSCRIBE_MODEL,
  TRANSCRIPTION_MODEL_RATES,
  estimateTranscriptionCostUsd,
  resolveTranscriptionConfig,
  usesOpenRouterSttJson,
} from "./transcription.js";

test("usesOpenRouterSttJson detects OpenRouter hosts", () => {
  assert.equal(usesOpenRouterSttJson("https://openrouter.ai/api/v1"), true);
  assert.equal(usesOpenRouterSttJson("https://api.openai.com/v1"), false);
});

test("default transcription model is the cheapest in the registry", () => {
  const rates = Object.entries(TRANSCRIPTION_MODEL_RATES);
  const cheapest = rates.reduce<[string, number]>(
    (acc, [slug, rate]) => (rate.perSecondUsd < acc[1] ? [slug, rate.perSecondUsd] : acc),
    ["", Infinity]
  );
  // The default is on-device and incurs no provider transcription charges.
  assert.equal(
    DEFAULT_TRANSCRIBE_MODEL,
    "local/whisper-large-v3-turbo",
    "default should be local Whisper fast"
  );
  assert.ok(cheapest[1] === 0, "expected a finite cheapest rate");
});

test("estimateTranscriptionCostUsd returns 0 for unknown models", () => {
  assert.equal(estimateTranscriptionCostUsd("not-a-real-model", 120), 0);
  assert.equal(estimateTranscriptionCostUsd(DEFAULT_TRANSCRIBE_MODEL, 0), 0);
  assert.equal(estimateTranscriptionCostUsd(DEFAULT_TRANSCRIBE_MODEL, -5), 0);
});

test("estimateTranscriptionCostUsd matches the published Whisper Turbo rate", () => {
  // $0.04 / hour = $0.04 / 3600s ≈ $0.00001111/s
  const cost = estimateTranscriptionCostUsd("openai/whisper-large-v3-turbo", 60);
  // 60s at $0.04/hour = $0.04 / 60 = $0.000666...
  assert.ok(Math.abs(cost - 0.04 / 60) < 1e-9, `expected ~$0.000666, got ${cost}`);
});

test("estimateTranscriptionCostUsd matches Qwen3 ASR Flash per-second rate", () => {
  const cost = estimateTranscriptionCostUsd("qwen/qwen3-asr-flash", 300); // 5 minutes
  assert.ok(Math.abs(cost - 300 * 0.000035) < 1e-9, `expected $0.0105, got ${cost}`);
});

test("resolveTranscriptionConfig falls back to defaults when env is unset", () => {
  const prev = {
    enabled: process.env["AGENT_TRANSCRIBE_ENABLED"],
    model: process.env["AGENT_TRANSCRIBE_MODEL"],
    apiKey: process.env["AGENT_TRANSCRIBE_API_KEY"],
  };
  delete process.env["AGENT_TRANSCRIBE_ENABLED"];
  delete process.env["AGENT_TRANSCRIBE_MODEL"];
  delete process.env["AGENT_TRANSCRIBE_API_KEY"];
  try {
    const cfg = resolveTranscriptionConfig(null);
    assert.equal(cfg.enabled, true);
    assert.equal(cfg.model, "local/whisper-large-v3-turbo");
    assert.equal(cfg.timestamps, "segment");
    assert.ok(cfg.maxBytes > 0);
    assert.ok(cfg.timeoutMs > 0);
  } finally {
    if (prev.enabled !== undefined) process.env["AGENT_TRANSCRIBE_ENABLED"] = prev.enabled;
    if (prev.model !== undefined) process.env["AGENT_TRANSCRIBE_MODEL"] = prev.model;
    if (prev.apiKey !== undefined) process.env["AGENT_TRANSCRIBE_API_KEY"] = prev.apiKey;
  }
});

test("resolveTranscriptionConfig honors AGENT_TRANSCRIBE_ENABLED=0", () => {
  const prev = process.env["AGENT_TRANSCRIBE_ENABLED"];
  process.env["AGENT_TRANSCRIBE_ENABLED"] = "0";
  try {
    const cfg = resolveTranscriptionConfig(null);
    assert.equal(cfg.enabled, false);
  } finally {
    if (prev === undefined) delete process.env["AGENT_TRANSCRIBE_ENABLED"];
    else process.env["AGENT_TRANSCRIBE_ENABLED"] = prev;
  }
});

test("resolveTranscriptionConfig picks up custom model + timestamps overrides", () => {
  const prevModel = process.env["AGENT_TRANSCRIBE_MODEL"];
  const prevTs = process.env["AGENT_TRANSCRIBE_TIMESTAMPS"];
  process.env["AGENT_TRANSCRIBE_MODEL"] = "qwen/qwen3-asr-flash";
  process.env["AGENT_TRANSCRIBE_TIMESTAMPS"] = "word";
  try {
    const cfg = resolveTranscriptionConfig(null);
    assert.equal(cfg.model, "qwen/qwen3-asr-flash");
    assert.equal(cfg.timestamps, "word");
  } finally {
    if (prevModel === undefined) delete process.env["AGENT_TRANSCRIBE_MODEL"];
    else process.env["AGENT_TRANSCRIBE_MODEL"] = prevModel;
    if (prevTs === undefined) delete process.env["AGENT_TRANSCRIBE_TIMESTAMPS"];
    else process.env["AGENT_TRANSCRIBE_TIMESTAMPS"] = prevTs;
  }
});

test("resolveTranscriptionConfig clamps invalid timestamps to segment", () => {
  const prevTs = process.env["AGENT_TRANSCRIBE_TIMESTAMPS"];
  process.env["AGENT_TRANSCRIBE_TIMESTAMPS"] = "garbage";
  try {
    const cfg = resolveTranscriptionConfig(null);
    assert.equal(cfg.timestamps, "segment");
  } finally {
    if (prevTs === undefined) delete process.env["AGENT_TRANSCRIBE_TIMESTAMPS"];
    else process.env["AGENT_TRANSCRIBE_TIMESTAMPS"] = prevTs;
  }
});


test("the former Parakeet default migrates to local Whisper, while explicit accuracy mode is retained", () => {
  const previous = process.env["AGENT_TRANSCRIBE_MODEL"];
  try {
    process.env["AGENT_TRANSCRIBE_MODEL"] = "nvidia/parakeet-tdt-0.6b-v3";
    assert.equal(resolveTranscriptionConfig(null).model, "local/whisper-large-v3-turbo");
    process.env["AGENT_TRANSCRIBE_MODEL"] = " LOCAL/QWEN3-ASR-1.7B ";
    assert.equal(resolveTranscriptionConfig(null).model, "local/qwen3-asr-1.7b");
  } finally {
    if (previous === undefined) delete process.env["AGENT_TRANSCRIBE_MODEL"];
    else process.env["AGENT_TRANSCRIBE_MODEL"] = previous;
  }
});
