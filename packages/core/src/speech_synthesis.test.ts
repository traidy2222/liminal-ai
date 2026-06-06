import test from "node:test";
import assert from "node:assert/strict";
import {
  coerceTtsVoiceForModel,
  DEFAULT_TTS_MODEL,
  DEFAULT_TTS_VOICE,
  estimateTtsCostUsd,
  resolveSpeechSynthesisConfig,
  sanitizeTextForTts,
  TTS_MODEL_INPUT_MAX_CHARS,
  TTS_MODEL_OUTPUT_MAX_TOKENS,
  DEFAULT_TTS_CHUNK_CHARS,
  ttsMaxOutputTokensForInput,
  splitTextForTtsChunks,
  wireTtsResponseFormat,
  coerceTtsConfigForBrowserPlayback,
  wrapPcm16LeMonoAsWav,
  normalizeTtsBytesForBrowserPlayback,
  normalizeTtsModelSlug,
} from "./speech_synthesis.js";
import { TtsTurnBudget } from "./tts_budget.js";

test("default TTS model is Kokoro 82M", () => {
  assert.equal(DEFAULT_TTS_MODEL, "hexgrad/kokoro-82m");
});

test("normalizeTtsModelSlug maps GPT-4o Mini TTS ids to affordable Kokoro", () => {
  assert.equal(
    normalizeTtsModelSlug("openai/gpt-4o-mini-tts-2024-12-19"),
    "hexgrad/kokoro-82m"
  );
  assert.equal(
    normalizeTtsModelSlug("openai/gpt-4o-mini-tts-2025-12-15"),
    "hexgrad/kokoro-82m"
  );
  assert.equal(normalizeTtsModelSlug("hexgrad/kokoro-82m"), "hexgrad/kokoro-82m");
});

test("estimateTtsCostUsd returns 0 for unknown models", () => {
  assert.equal(estimateTtsCostUsd("not-a-model", 100), 0);
  assert.equal(estimateTtsCostUsd(DEFAULT_TTS_MODEL, 0), 0);
});

test("estimateTtsCostUsd matches Kokoro per-char rate", () => {
  const cost = estimateTtsCostUsd("hexgrad/kokoro-82m", 1000);
  assert.ok(Math.abs(cost - (1000 * 0.62) / 1_000_000) < 1e-12);
});

test("sanitizeTextForTts strips code fences and caps length", () => {
  const raw = "Hello ```js\nconst x = 1;\n``` world " + "x".repeat(300);
  const out = sanitizeTextForTts(raw, 50);
  assert.ok(!out.includes("```"));
  assert.ok(!out.includes("const"));
  assert.ok(out.length <= 50);
});

test("resolveSpeechSynthesisConfig defaults TTS off", () => {
  const prev = process.env["AGENT_TTS_ENABLED"];
  delete process.env["AGENT_TTS_ENABLED"];
  try {
    const cfg = resolveSpeechSynthesisConfig(null);
    assert.equal(cfg.enabled, false);
    assert.equal(cfg.model, "hexgrad/kokoro-82m");
    assert.equal(cfg.maxCallsPerTurn, 8);
  } finally {
    if (prev !== undefined) process.env["AGENT_TTS_ENABLED"] = prev;
  }
});

test("splitTextForTtsChunks keeps short text intact", () => {
  const one = "Hello world.";
  assert.deepEqual(splitTextForTtsChunks(one, DEFAULT_TTS_CHUNK_CHARS), [one]);
});

test("splitTextForTtsChunks splits long prose on sentence boundaries", () => {
  const para =
    "First sentence here. " +
    "Second sentence with more words in it. " +
    "Third sentence continues the thought. " +
    "Fourth sentence wraps up the paragraph with a conclusion.";
  const chunks = splitTextForTtsChunks(para.repeat(8), 120);
  assert.ok(chunks.length > 1);
  for (const c of chunks) {
    assert.ok(c.length <= 120);
  }
  const rebuilt = chunks.join(" ");
  assert.ok(rebuilt.startsWith("First sentence"));
  assert.ok(rebuilt.includes("wraps up the paragraph"));
});

test("resolveSpeechSynthesisConfig defaults chunk chars", () => {
  const prev = process.env["AGENT_TTS_CHUNK_CHARS"];
  delete process.env["AGENT_TTS_CHUNK_CHARS"];
  try {
    const cfg = resolveSpeechSynthesisConfig(null);
    assert.equal(cfg.chunkChars, DEFAULT_TTS_CHUNK_CHARS);
  } finally {
    if (prev === undefined) delete process.env["AGENT_TTS_CHUNK_CHARS"];
    else process.env["AGENT_TTS_CHUNK_CHARS"] = prev;
  }
});

test("resolveSpeechSynthesisConfig defaults max chars to model 4K limit", () => {
  const prev = process.env["AGENT_TTS_MAX_CHARS_PER_CALL"];
  delete process.env["AGENT_TTS_MAX_CHARS_PER_CALL"];
  try {
    const cfg = resolveSpeechSynthesisConfig(null);
    assert.equal(cfg.maxCharsPerCall, TTS_MODEL_INPUT_MAX_CHARS);
  } finally {
    if (prev === undefined) delete process.env["AGENT_TTS_MAX_CHARS_PER_CALL"];
    else process.env["AGENT_TTS_MAX_CHARS_PER_CALL"] = prev;
  }
});

test("ttsMaxOutputTokensForInput scales with text but respects cap", () => {
  assert.equal(ttsMaxOutputTokensForInput(100, TTS_MODEL_OUTPUT_MAX_TOKENS), 512);
  assert.equal(ttsMaxOutputTokensForInput(5000, TTS_MODEL_OUTPUT_MAX_TOKENS), TTS_MODEL_OUTPUT_MAX_TOKENS);
  assert.ok(ttsMaxOutputTokensForInput(2000, TTS_MODEL_OUTPUT_MAX_TOKENS) >= 4000);
});

test("resolveSpeechSynthesisConfig includes maxOutputTokens default", () => {
  const prev = process.env["AGENT_TTS_MAX_OUTPUT_TOKENS"];
  delete process.env["AGENT_TTS_MAX_OUTPUT_TOKENS"];
  try {
    const cfg = resolveSpeechSynthesisConfig(null);
    assert.equal(cfg.maxOutputTokens, TTS_MODEL_OUTPUT_MAX_TOKENS);
  } finally {
    if (prev === undefined) delete process.env["AGENT_TTS_MAX_OUTPUT_TOKENS"];
    else process.env["AGENT_TTS_MAX_OUTPUT_TOKENS"] = prev;
  }
});

test("resolveSpeechSynthesisConfig clamps max chars above 4096", () => {
  const prev = process.env["AGENT_TTS_MAX_CHARS_PER_CALL"];
  process.env["AGENT_TTS_MAX_CHARS_PER_CALL"] = "8000";
  try {
    const cfg = resolveSpeechSynthesisConfig(null);
    assert.equal(cfg.maxCharsPerCall, TTS_MODEL_INPUT_MAX_CHARS);
  } finally {
    if (prev === undefined) delete process.env["AGENT_TTS_MAX_CHARS_PER_CALL"];
    else process.env["AGENT_TTS_MAX_CHARS_PER_CALL"] = prev;
  }
});

test("resolveSpeechSynthesisConfig honors AGENT_TTS_ENABLED=1", () => {
  const prev = process.env["AGENT_TTS_ENABLED"];
  process.env["AGENT_TTS_ENABLED"] = "1";
  try {
    const cfg = resolveSpeechSynthesisConfig(null);
    assert.equal(cfg.enabled, true);
  } finally {
    if (prev === undefined) delete process.env["AGENT_TTS_ENABLED"];
    else process.env["AGENT_TTS_ENABLED"] = prev;
  }
});

test("coerceTtsConfigForBrowserPlayback forces mp3", () => {
  const cfg = resolveSpeechSynthesisConfig(null);
  const pcmCfg = { ...cfg, responseFormat: "pcm" as const };
  assert.equal(coerceTtsConfigForBrowserPlayback(pcmCfg).responseFormat, "mp3");
  assert.equal(coerceTtsConfigForBrowserPlayback({ ...cfg, responseFormat: "mp3" }).responseFormat, "mp3");
});

test("wrapPcm16LeMonoAsWav produces a RIFF WAVE header", () => {
  const pcm = new Uint8Array([0, 0, 0xff, 0x7f]);
  const wav = wrapPcm16LeMonoAsWav(pcm);
  assert.equal(String.fromCharCode(...wav.slice(0, 4)), "RIFF");
  assert.equal(String.fromCharCode(...wav.slice(8, 12)), "WAVE");
  assert.equal(wav.length, 44 + pcm.length);
});

test("normalizeTtsBytesForBrowserPlayback wraps pcm mime", () => {
  const pcm = new Uint8Array(128);
  const out = normalizeTtsBytesForBrowserPlayback(pcm, "audio/pcm");
  assert.equal(out.mimeType, "audio/wav");
  assert.ok(out.bytes.length > pcm.length);
});

test("wireTtsResponseFormat maps wav to mp3 on OpenRouter", () => {
  assert.equal(
    wireTtsResponseFormat("https://openrouter.ai/api/v1", "wav"),
    "mp3"
  );
  assert.equal(wireTtsResponseFormat("https://openrouter.ai/api/v1", "mp3"), "mp3");
});

test("coerceTtsVoiceForModel maps OpenAI voices off Kokoro", () => {
  assert.equal(
    coerceTtsVoiceForModel("hexgrad/kokoro-82m", "alloy"),
    DEFAULT_TTS_VOICE
  );
  assert.equal(coerceTtsVoiceForModel("hexgrad/kokoro-82m", "af_bella"), "af_bella");
});

test("coerceTtsVoiceForModel maps Kokoro voices off OpenAI TTS", () => {
  assert.equal(
    coerceTtsVoiceForModel("openai/gpt-4o-mini-tts-2025-12-15", "af_sky"),
    "nova"
  );
  assert.equal(
    coerceTtsVoiceForModel("openai/gpt-4o-mini-tts-2025-12-15", "shimmer"),
    "shimmer"
  );
});

test("TtsTurnBudget enforces per-turn cap", () => {
  const budget = new TtsTurnBudget();
  const cfg = resolveSpeechSynthesisConfig(null);
  const enabledCfg = { ...cfg, enabled: true, maxCallsPerTurn: 2, minIntervalMs: 0 };
  assert.equal(budget.tryConsume("one", enabledCfg).ok, true);
  assert.equal(budget.tryConsume("two", enabledCfg).ok, true);
  const third = budget.tryConsume("three", enabledCfg);
  assert.equal(third.ok, false);
  assert.match(third.reason ?? "", /cap/i);
});
