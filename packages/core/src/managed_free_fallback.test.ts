import assert from "node:assert/strict";
import test from "node:test";
import OpenAI from "openai";
import {
  buildManagedFreeFallbackHarnessEnv,
  isModelIncompatibleWithManagedProxy,
  managedFreeFallbackEnabled,
  resolveManagedFreeFallbackFastModel,
  resolveManagedFreeFallbackMainModel,
  resolveModelForManagedInference,
} from "./managed_free_fallback.js";
import { DEFAULT_AGENT_MODEL_SLUG } from "./harness_default_constants.js";
import { isInferenceBudgetExceededError } from "./inference_provider.js";
import { OPENROUTER_MODEL_SLUG } from "./provider_model_presets.js";

test("managedFreeFallbackEnabled defaults on", () => {
  assert.equal(managedFreeFallbackEnabled(null), true);
});

test("resolveManagedFreeFallbackMainModel defaults to openrouter/free", () => {
  assert.equal(resolveManagedFreeFallbackMainModel(null), OPENROUTER_MODEL_SLUG.FREE_ROUTER);
});

test("resolveManagedFreeFallbackFastModel defaults to Nemotron 3 Ultra when main is openrouter/free", () => {
  assert.equal(
    resolveManagedFreeFallbackFastModel(OPENROUTER_MODEL_SLUG.FREE_ROUTER, null),
    OPENROUTER_MODEL_SLUG.NEMOTRON_3_ULTRA_FREE
  );
});

test("buildManagedFreeFallbackHarnessEnv pairs openrouter/free main with Nemotron ultra fast", () => {
  const env = buildManagedFreeFallbackHarnessEnv(null);
  assert.equal(env.AGENT_MODEL, OPENROUTER_MODEL_SLUG.FREE_ROUTER);
  assert.equal(env.AGENT_FAST_MODEL, OPENROUTER_MODEL_SLUG.NEMOTRON_3_ULTRA_FREE);
  assert.equal(env.AGENT_PROVIDER_STRATEGY, "price");
  assert.equal(env.AGENT_PROVIDER_ORDER, "");
});

test("buildManagedFreeFallbackHarnessEnv pins Stealth for owl-alpha override", () => {
  const env = buildManagedFreeFallbackHarnessEnv({
    version: 1,
    updatedAt: 0,
    harness: { env: { AGENT_MANAGED_FREE_FALLBACK_MODEL: OPENROUTER_MODEL_SLUG.OWL_ALPHA } },
  });
  assert.equal(env.AGENT_MODEL, OPENROUTER_MODEL_SLUG.OWL_ALPHA);
  assert.equal(env.AGENT_PROVIDER_ORDER, "Stealth");
});

test("isInferenceBudgetExceededError detects 402 budget body", () => {
  const err = new OpenAI.APIError(402, { error: "inference_budget_exceeded" }, "budget", {});
  assert.equal(isInferenceBudgetExceededError(err), true);
});

test("isModelIncompatibleWithManagedProxy flags openrouter/free and :free slugs", () => {
  assert.equal(isModelIncompatibleWithManagedProxy(OPENROUTER_MODEL_SLUG.FREE_ROUTER), true);
  assert.equal(isModelIncompatibleWithManagedProxy("openrouter/auto"), true);
  assert.equal(isModelIncompatibleWithManagedProxy("nvidia/foo:free"), true);
  assert.equal(isModelIncompatibleWithManagedProxy(DEFAULT_AGENT_MODEL_SLUG), false);
});

test("isModelIncompatibleWithManagedProxy allows openrouter/fusion on managed inference", () => {
  assert.equal(isModelIncompatibleWithManagedProxy(OPENROUTER_MODEL_SLUG.FUSION), false);
});

test("resolveModelForManagedInference keeps openrouter/fusion", () => {
  assert.equal(
    resolveModelForManagedInference(OPENROUTER_MODEL_SLUG.FUSION, null),
    OPENROUTER_MODEL_SLUG.FUSION
  );
});

test("resolveModelForManagedInference replaces fallback slug with default main model", () => {
  assert.equal(
    resolveModelForManagedInference(OPENROUTER_MODEL_SLUG.FREE_ROUTER, null),
    DEFAULT_AGENT_MODEL_SLUG
  );
});
