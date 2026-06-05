import test from "node:test";

import assert from "node:assert/strict";

import {
  buildHarnessModelPackEnvPatch,
  listProviderPresetsForSettings,
  OPENROUTER_MODEL_SLUG,
  PROVIDER_MODEL_PRESETS,
  PROVIDER_PRESET_CUSTOM_ID,
  resolveProviderModelPresetId,
  resolveProviderPresetId,
} from "./provider_model_presets.js";



test("buildHarnessModelPackEnvPatch sets main, fast, and sidecar model keys", () => {

  const patch = buildHarnessModelPackEnvPatch({

    main: OPENROUTER_MODEL_SLUG.MIMO_V25_PRO,

    fast: OPENROUTER_MODEL_SLUG.MIMO_V25,

  });

  assert.equal(patch.AGENT_MODEL, "xiaomi/mimo-v2.5-pro");

  assert.equal(patch.AGENT_FAST_MODEL, "xiaomi/mimo-v2.5");

  assert.equal(patch.AGENT_SAFETY_JUDGE_MODEL, "xiaomi/mimo-v2.5");

});



test("deepseek and mimo presets use distinct main models", () => {

  const deepseek = PROVIDER_MODEL_PRESETS.find((p) => p.id === "deepseek-v4")!;

  const mimo = PROVIDER_MODEL_PRESETS.find((p) => p.id === "mimo-v2.5")!;

  assert.notEqual(deepseek.model, mimo.model);

  assert.equal(deepseek.harnessEnvPatch.AGENT_FAST_MODEL, OPENROUTER_MODEL_SLUG.DEEPSEEK_V4_FLASH);

});



test("resolveProviderModelPresetId matches OpenRouter base + main slug", () => {

  const id = resolveProviderModelPresetId(

    OPENROUTER_MODEL_SLUG.DEEPSEEK_V4_PRO,

    "https://openrouter.ai/api/v1"

  );

  assert.equal(id, "deepseek-v4");

});



test("deepseek price preset uses price strategy (benchmark default)", () => {
  const deepseek = PROVIDER_MODEL_PRESETS.find((p) => p.id === "deepseek-v4")!;
  assert.equal(deepseek.harnessEnvPatch.AGENT_PROVIDER_STRATEGY, "price");
  assert.equal(deepseek.harnessEnvPatch.AGENT_PROVIDER_ORDER, "");
});

test("deepseek adaptive preset available for 429-heavy workloads", () => {
  const adaptive = PROVIDER_MODEL_PRESETS.find((p) => p.id === "deepseek-v4-adaptive")!;
  assert.equal(adaptive.harnessEnvPatch.AGENT_PROVIDER_STRATEGY, "adaptive");
});

test("deepseek deepinfra pin preset uses cache_first", () => {
  const pin = PROVIDER_MODEL_PRESETS.find((p) => p.id === "deepseek-v4-deepinfra-pin")!;
  assert.equal(pin.harnessEnvPatch.AGENT_PROVIDER_STRATEGY, "cache_first");
  assert.equal(pin.harnessEnvPatch.AGENT_PROVIDER_ORDER, "DeepInfra");
});

test("owl stealth preset pins Stealth provider and owl-alpha slug", () => {
  const owl = PROVIDER_MODEL_PRESETS.find((p) => p.id === "openrouter-owl-stealth")!;
  assert.equal(owl.model, OPENROUTER_MODEL_SLUG.OWL_ALPHA);
  assert.equal(owl.harnessEnvPatch.AGENT_MODEL, OPENROUTER_MODEL_SLUG.OWL_ALPHA);
  assert.equal(owl.harnessEnvPatch.AGENT_FAST_MODEL, OPENROUTER_MODEL_SLUG.OWL_ALPHA);
  assert.equal(owl.harnessEnvPatch.AGENT_PROVIDER_STRATEGY, "cache_first");
  assert.equal(owl.harnessEnvPatch.AGENT_PROVIDER_ORDER, "Stealth");
  assert.equal(owl.harnessEnvPatch.AGENT_PROVIDER_ORDER_FAST, "Stealth");
});

test("resolveProviderPresetId matches owl stealth pack", () => {
  assert.equal(
    resolveProviderPresetId(OPENROUTER_MODEL_SLUG.OWL_ALPHA, "https://openrouter.ai/api/v1"),
    "openrouter-owl-stealth"
  );
});

test("listProviderPresetsForSettings includes custom and owl stealth", () => {
  const presets = listProviderPresetsForSettings();
  assert.ok(presets.some((p) => p.id === PROVIDER_PRESET_CUSTOM_ID));
  assert.ok(presets.some((p) => p.id === "openrouter-owl-stealth"));
});



test("latest vendor packs use current OpenRouter slugs", () => {

  const google = PROVIDER_MODEL_PRESETS.find((p) => p.id === "google-gemini-3.5")!;

  assert.equal(google.harnessEnvPatch.AGENT_MODEL, OPENROUTER_MODEL_SLUG.GEMINI_35_FLASH);

  assert.equal(google.harnessEnvPatch.AGENT_FAST_MODEL, OPENROUTER_MODEL_SLUG.GEMINI_31_FLASH_LITE);



  const qwen = PROVIDER_MODEL_PRESETS.find((p) => p.id === "qwen-3.6")!;

  assert.equal(qwen.harnessEnvPatch.AGENT_MODEL, OPENROUTER_MODEL_SLUG.QWEN36_PLUS);



  const gpt = PROVIDER_MODEL_PRESETS.find((p) => p.id === "openai-gpt-5.5")!;

  assert.equal(gpt.harnessEnvPatch.AGENT_FAST_MODEL, OPENROUTER_MODEL_SLUG.GPT_54_MINI);



  assert.equal(PROVIDER_MODEL_PRESETS.find((p) => p.id === "google-gemini-2.5"), undefined);

  assert.equal(PROVIDER_MODEL_PRESETS.find((p) => p.id === "qwen-3.5-plus"), undefined);

  assert.equal(PROVIDER_MODEL_PRESETS.find((p) => p.id === "anthropic-claude-4.7"), undefined);

});


