import test from "node:test";

import assert from "node:assert/strict";

import {
  buildHarnessModelPackEnvPatch,
  inferPresetBackend,
  KIMCHI_MODEL_PRESETS,
  listProviderPresetsForBackend,
  listProviderPresetsForSettings,
  OPENROUTER_MODEL_SLUG,
  PROVIDER_MODEL_PRESETS,
  PROVIDER_PRESET_CUSTOM_ID,
  resolveProviderModelPresetId,
  resolveProviderPresetId,
} from "./provider_model_presets.js";
import { KIMCHI_API_BASE_URL, KIMCHI_MODEL_SLUG } from "./kimchi_provider.js";
import { apiKeyEnvVarForBaseUrl, resolveProviderBackendId } from "./provider_backends.js";



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

test("nemotron-3-ultra preset uses Nemotron 3 Ultra free slug for main and fast", () => {
  const pack = PROVIDER_MODEL_PRESETS.find((p) => p.id === "nemotron-3-ultra")!;
  assert.equal(pack.model, OPENROUTER_MODEL_SLUG.NEMOTRON_3_ULTRA_FREE);
  assert.equal(pack.harnessEnvPatch.AGENT_MODEL, OPENROUTER_MODEL_SLUG.NEMOTRON_3_ULTRA_FREE);
  assert.equal(pack.harnessEnvPatch.AGENT_FAST_MODEL, OPENROUTER_MODEL_SLUG.NEMOTRON_3_ULTRA_FREE);
});

test("free-router-nemotron-ultra preset pairs openrouter/free with Nemotron 3 Ultra fast", () => {
  const pack = PROVIDER_MODEL_PRESETS.find((p) => p.id === "free-router-nemotron-ultra")!;
  assert.equal(pack.harnessEnvPatch.AGENT_MODEL, OPENROUTER_MODEL_SLUG.FREE_ROUTER);
  assert.equal(pack.harnessEnvPatch.AGENT_FAST_MODEL, OPENROUTER_MODEL_SLUG.NEMOTRON_3_ULTRA_FREE);
});

test("resolveProviderPresetId matches nemotron-3-ultra pack", () => {
  assert.equal(
    resolveProviderPresetId(OPENROUTER_MODEL_SLUG.NEMOTRON_3_ULTRA_FREE, "https://openrouter.ai/api/v1"),
    "nemotron-3-ultra"
  );
});

test("nex-n2-pro-free preset enables native vision and aligns vision model", () => {
  const pack = PROVIDER_MODEL_PRESETS.find((p) => p.id === "nex-n2-pro-free")!;
  assert.equal(pack.model, OPENROUTER_MODEL_SLUG.NEX_N2_PRO_FREE);
  assert.equal(pack.harnessEnvPatch.AGENT_MODEL, OPENROUTER_MODEL_SLUG.NEX_N2_PRO_FREE);
  assert.equal(pack.harnessEnvPatch.AGENT_NATIVE_VISION_SLUGS, OPENROUTER_MODEL_SLUG.NEX_N2_PRO_FREE);
  assert.equal(pack.harnessEnvPatch.AGENT_VISION_MODEL, OPENROUTER_MODEL_SLUG.NEX_N2_PRO_FREE);
});

test("resolveProviderPresetId matches nex-n2-pro-free pack", () => {
  assert.equal(
    resolveProviderPresetId(OPENROUTER_MODEL_SLUG.NEX_N2_PRO_FREE, "https://openrouter.ai/api/v1"),
    "nex-n2-pro-free"
  );
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

test("kimchi presets use Cast AI base URL and clear OpenRouter routing", () => {
  const pack = KIMCHI_MODEL_PRESETS.find((p) => p.id === "kimchi-kimi-k25")!;
  assert.equal(pack.baseURL, KIMCHI_API_BASE_URL);
  assert.equal(pack.model, KIMCHI_MODEL_SLUG.KIMI_K25);
  assert.equal(pack.harnessEnvPatch.AGENT_PROVIDER_STRATEGY, "openrouter_default");
  assert.equal(pack.harnessEnvPatch.AGENT_PROVIDER_ORDER, "");
});

test("listProviderPresetsForBackend filters by provider", () => {
  const kimchi = listProviderPresetsForBackend("kimchi");
  const openrouter = listProviderPresetsForBackend("openrouter");
  assert.ok(kimchi.every((p) => inferPresetBackend(p) === "kimchi"));
  assert.ok(openrouter.every((p) => inferPresetBackend(p) === "openrouter"));
  assert.ok(kimchi.some((p) => p.id === "kimchi-minimax-m27"));
  assert.ok(!kimchi.some((p) => p.id === "deepseek-v4"));
  assert.ok(openrouter.some((p) => p.id === "deepseek-v4"));
  assert.ok(openrouter.some((p) => p.id === "mix-deepseek-haiku"));
  assert.ok(!openrouter.some((p) => p.id.startsWith("kimchi-")));
});

test("inferPresetBackend works without providerBackend field", () => {
  const deepseek = listProviderPresetsForSettings().find((p) => p.id === "deepseek-v4")!;
  const kimchi = listProviderPresetsForSettings().find((p) => p.id === "kimchi-kimi-k25")!;
  assert.equal(inferPresetBackend({ ...deepseek, providerBackend: undefined }), "openrouter");
  assert.equal(inferPresetBackend({ ...kimchi, providerBackend: undefined }), "kimchi");
});

test("resolveProviderBackendId detects kimchi and openrouter bases", () => {
  assert.equal(resolveProviderBackendId(KIMCHI_API_BASE_URL), "kimchi");
  assert.equal(resolveProviderBackendId("https://openrouter.ai/api/v1"), "openrouter");
  assert.equal(resolveProviderBackendId("http://localhost:1234/v1"), "local");
});

test("apiKeyEnvVarForBaseUrl maps kimchi to KIMCHI_API_KEY", () => {
  assert.equal(apiKeyEnvVarForBaseUrl(KIMCHI_API_BASE_URL), "KIMCHI_API_KEY");
  assert.equal(apiKeyEnvVarForBaseUrl("https://openrouter.ai/api/v1"), "OPENROUTER_API_KEY");
});

test("resolveProviderPresetId matches kimchi minimax pack", () => {
  assert.equal(
    resolveProviderPresetId(KIMCHI_MODEL_SLUG.MINIMAX_M27, KIMCHI_API_BASE_URL),
    "kimchi-minimax-m27"
  );
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


