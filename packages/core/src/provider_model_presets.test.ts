import test from "node:test";
import assert from "node:assert/strict";
import {
  buildHarnessModelPackEnvPatch,
  OPENROUTER_MODEL_SLUG,
  PROVIDER_MODEL_PRESETS,
  resolveProviderModelPresetId,
} from "./provider_model_presets.js";

test("buildHarnessModelPackEnvPatch sets main, fast, and sidecar model keys", () => {
  const patch = buildHarnessModelPackEnvPatch({
    main: OPENROUTER_MODEL_SLUG.MIMO_V25_PRO,
    fast: OPENROUTER_MODEL_SLUG.MIMO_V25,
  });
  assert.equal(patch.AGENT_MODEL, "xiaomi/mimo-v2.5-pro");
  assert.equal(patch.AGENT_FAST_MODEL, "xiaomi/mimo-v2.5");
  assert.equal(patch.AGENT_SAFETY_JUDGE_MODEL, "xiaomi/mimo-v2.5");
  assert.equal(patch.AGENT_MEMORY_AUTOLINK_MODEL, "xiaomi/mimo-v2.5");
  assert.equal(patch.AGENT_MEMORY_CONSOLIDATE_MODEL, "xiaomi/mimo-v2.5");
});

test("deepseek and mimo presets use distinct main models", () => {
  const deepseek = PROVIDER_MODEL_PRESETS.find((p) => p.id === "deepseek-v4")!;
  const mimo = PROVIDER_MODEL_PRESETS.find((p) => p.id === "mimo-v2.5")!;
  assert.notEqual(deepseek.model, mimo.model);
  assert.equal(deepseek.harnessEnvPatch.AGENT_FAST_MODEL, OPENROUTER_MODEL_SLUG.DEEPSEEK_V4_FLASH);
  assert.equal(mimo.harnessEnvPatch.AGENT_FAST_MODEL, OPENROUTER_MODEL_SLUG.MIMO_V25);
});

test("resolveProviderModelPresetId matches OpenRouter base + main slug", () => {
  const id = resolveProviderModelPresetId(
    OPENROUTER_MODEL_SLUG.DEEPSEEK_V4_PRO,
    "https://openrouter.ai/api/v1"
  );
  assert.equal(id, "deepseek-v4");
});
