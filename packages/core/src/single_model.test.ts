import test from "node:test";
import assert from "node:assert/strict";
import type OpenAI from "openai";
import type { RuntimePreferences } from "./runtime_prefs.js";
import { runHarnessEffectiveEnvContext, resolveHarnessEnvRaw, singleModelSlug } from "./harness_effective_env.js";
import { completeChatJson, getFastModelSlug } from "./router.js";
import { fetchEmbeddings } from "./embeddings.js";
import { resolveSpeechSynthesisConfig } from "./speech_synthesis.js";
import { resolveTranscriptionConfig } from "./transcription.js";
import { resolveVisionProviderConfigAsync } from "./provider_config.js";

function prefs(model = "vendor/chosen", enabled = "1"): RuntimePreferences {
  return { version: 1, updatedAt: 0, provider: { model, baseURL: "https://openrouter.ai/api/v1" }, harness: { env: {
    AGENT_SINGLE_MODEL: enabled, AGENT_FAST_MODEL: "vendor/fast", AGENT_VISION_MODEL: "vendor/vision", AGENT_EMBED_MODEL: "vendor/embed",
    AGENT_TTS_ENABLED: "1", AGENT_TRANSCRIBE_ENABLED: "1", AGENT_MANAGED_FREE_FALLBACK: "1",
  } } };
}
test("single-model policy follows selected model and preserves specialist settings when turned off", () => {
  const p = prefs();
  for (const key of ["AGENT_FAST_MODEL", "AGENT_SAFETY_JUDGE_MODEL", "AGENT_PERSONA_INFER_MODEL", "AGENT_VISION_MODEL", "AGENT_WORKFLOW_MODEL", "AGENT_MEMORY_CURATOR_MODEL"]) assert.equal(resolveHarnessEnvRaw(key, p), "vendor/chosen");
  assert.equal(resolveHarnessEnvRaw("AGENT_EMBED_MODEL", p), "");
  assert.equal(resolveHarnessEnvRaw("AGENT_MANAGED_FREE_FALLBACK", p), "0");
  assert.equal(resolveSpeechSynthesisConfig(p).enabled, false);
  assert.equal(resolveTranscriptionConfig(p).enabled, true); // On-device ASR is independent of chat routing.
  assert.equal(p.harness!.env!.AGENT_FAST_MODEL, "vendor/fast");
  assert.equal(resolveHarnessEnvRaw("AGENT_FAST_MODEL", prefs("vendor/chosen", "0")), "vendor/fast");
  assert.equal(resolveHarnessEnvRaw("AGENT_FAST_MODEL", prefs("vendor/new")), "vendor/new");
  for (const router of ["openrouter/fusion", "openrouter/auto-beta", "openrouter/pareto-code", "openrouter/bodybuilder"]) assert.throws(() => singleModelSlug(undefined, prefs(router)), /specific model/);
});
test("background completions enforce selected model instead of explicit overrides or fallbacks", async () => {
  const sent: string[] = [];
  const client = { apiKey: "test", baseURL: "http://localhost:1234/v1", chat: { completions: { create: async (body: { model: string }) => {
    sent.push(body.model); return { choices: [{ message: { content: '{"ok":true}' } }] };
  } } } } as unknown as OpenAI;
  await runHarnessEffectiveEnvContext(prefs(), async () => {
    assert.equal(getFastModelSlug("vendor/other"), "vendor/chosen");
    const result = await completeChatJson(client, { model: "vendor/other", fallbackModel: "vendor/fallback", messages: [], cache: false });
    assert.equal(result.ok, true);
    await assert.rejects(fetchEmbeddings({ apiKey: "test", baseURL: client.baseURL, model: "vendor/embed", inputs: ["hello"] }), /disabled in single-model/);
  });
  await runHarnessEffectiveEnvContext(prefs("vendor/new"), () => completeChatJson(client, { model: "vendor/old", messages: [], cache: false }));
  assert.deepEqual(sent, ["vendor/chosen", "vendor/new"]);
});

test("single-model background failure never substitutes a fallback model", async () => {
  const sent: string[] = [];
  const client = { apiKey: "test", baseURL: "http://localhost:1234/v1", chat: { completions: { create: async (body: { model: string }) => {
    sent.push(body.model); throw new Error("429 quota exceeded");
  } } } } as unknown as OpenAI;
  const result = await runHarnessEffectiveEnvContext(prefs(), () => completeChatJson(client, {
    model: "vendor/other", fallbackModel: "vendor/fallback", messages: [], cache: false,
  }));
  assert.equal(result.ok, false);
  assert.deepEqual(sent, ["vendor/chosen"]);
});

test("vision inherits active single-model provider even when callers pass null preferences", async () => {
  const previousKey = process.env["AGENT_API_KEY"];
  const previousMode = process.env["AGENT_INFERENCE_MODE"];
  const previousBase = process.env["AGENT_API_BASE_URL"];
  try {
    process.env["AGENT_API_KEY"] = "test-local-key";
    process.env["AGENT_INFERENCE_MODE"] = "byok";
    process.env["AGENT_API_BASE_URL"] = "http://localhost:1234/v1";
    const p = prefs();
    p.provider = { model: "local/selected", baseURL: "http://localhost:1234/v1", inferenceMode: "byok" };
    await runHarnessEffectiveEnvContext(p, async () => {
      const vision = await resolveVisionProviderConfigAsync(null);
      assert.equal(vision.model, "local/selected");
      assert.equal(vision.baseURL, "http://localhost:1234/v1");
      assert.equal(vision.apiKey, "test-local-key");
    });
  } finally {
    if (previousKey === undefined) delete process.env["AGENT_API_KEY"]; else process.env["AGENT_API_KEY"] = previousKey;
    if (previousMode === undefined) delete process.env["AGENT_INFERENCE_MODE"]; else process.env["AGENT_INFERENCE_MODE"] = previousMode;
    if (previousBase === undefined) delete process.env["AGENT_API_BASE_URL"]; else process.env["AGENT_API_BASE_URL"] = previousBase;
  }
});
