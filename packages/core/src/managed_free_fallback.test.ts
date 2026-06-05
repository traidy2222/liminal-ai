import assert from "node:assert/strict";
import test from "node:test";
import OpenAI from "openai";
import {
  buildManagedFreeFallbackHarnessEnv,
  managedFreeFallbackEnabled,
  resolveManagedFreeFallbackMainModel,
} from "./managed_free_fallback.js";
import { isInferenceBudgetExceededError } from "./inference_provider.js";
import { OPENROUTER_MODEL_SLUG } from "./provider_model_presets.js";

test("managedFreeFallbackEnabled defaults on", () => {
  assert.equal(managedFreeFallbackEnabled(null), true);
});

test("resolveManagedFreeFallbackMainModel defaults to owl-alpha", () => {
  assert.equal(resolveManagedFreeFallbackMainModel(null), OPENROUTER_MODEL_SLUG.OWL_ALPHA);
});

test("buildManagedFreeFallbackHarnessEnv pins Stealth for owl-alpha", () => {
  const env = buildManagedFreeFallbackHarnessEnv(null);
  assert.equal(env.AGENT_MODEL, OPENROUTER_MODEL_SLUG.OWL_ALPHA);
  assert.equal(env.AGENT_FAST_MODEL, OPENROUTER_MODEL_SLUG.OWL_ALPHA);
  assert.equal(env.AGENT_PROVIDER_ORDER, "Stealth");
});

test("isInferenceBudgetExceededError detects 402 budget body", () => {
  const err = new OpenAI.APIError(402, { error: "inference_budget_exceeded" }, "budget", {});
  assert.equal(isInferenceBudgetExceededError(err), true);
});
