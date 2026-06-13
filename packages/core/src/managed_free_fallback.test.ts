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
import { isInferenceBudgetExceededError, isManagedInferenceAuthError } from "./inference_provider.js";
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

test("isManagedInferenceAuthError detects every 401 session reason (incl. expired)", () => {
  // The proxy returns these as the 401 body; the lapsed-session case ("expired")
  // is the one that used to slip through and hard-fail a long run mid-stream.
  for (const reason of ["expired", "bad signature", "malformed token", "bad payload", "invalid claims"]) {
    const err = new OpenAI.APIError(401, { error: reason }, reason, {});
    assert.equal(isManagedInferenceAuthError(err), true, `should flag 401 "${reason}"`);
  }
  // Non-401s are not session-auth errors.
  assert.equal(
    isManagedInferenceAuthError(new OpenAI.APIError(402, { error: "inference_budget_exceeded" }, "x", {})),
    false
  );
  assert.equal(
    isManagedInferenceAuthError(new OpenAI.APIError(403, { error: "not entitled" }, "x", {})),
    false
  );
});

test("isModelIncompatibleWithManagedProxy flags openrouter/free BYOK fallback only", () => {
  assert.equal(isModelIncompatibleWithManagedProxy(OPENROUTER_MODEL_SLUG.FREE_ROUTER), true);
  assert.equal(isModelIncompatibleWithManagedProxy("nvidia/foo:free"), false);
  assert.equal(isModelIncompatibleWithManagedProxy(OPENROUTER_MODEL_SLUG.NEX_N2_PRO_FREE), false);
  assert.equal(isModelIncompatibleWithManagedProxy(DEFAULT_AGENT_MODEL_SLUG), false);
  assert.equal(isModelIncompatibleWithManagedProxy("deepseek/deepseek-v4-pro"), false);
});

test("resolveModelForManagedInference keeps nex-n2-pro:free from prefs", () => {
  const prefs = {
    version: 1 as const,
    updatedAt: 0,
    provider: { model: OPENROUTER_MODEL_SLUG.NEX_N2_PRO_FREE },
    harness: { env: { AGENT_MODEL: OPENROUTER_MODEL_SLUG.NEX_N2_PRO_FREE } },
  };
  assert.equal(
    resolveModelForManagedInference("deepseek/deepseek-v4-pro", prefs),
    OPENROUTER_MODEL_SLUG.NEX_N2_PRO_FREE
  );
});

test("resolveModelForManagedInference replaces fallback slug with default main model", () => {
  assert.equal(
    resolveModelForManagedInference(OPENROUTER_MODEL_SLUG.FREE_ROUTER, null),
    DEFAULT_AGENT_MODEL_SLUG
  );
});

test("resolveModelForManagedInference prefers persisted prefs over stale harness config", () => {
  const prefs = {
    version: 1 as const,
    updatedAt: 0,
    provider: { model: "anthropic/claude-sonnet-4" },
    harness: { env: { AGENT_MODEL: "anthropic/claude-sonnet-4" } },
  };
  assert.equal(
    resolveModelForManagedInference("deepseek/deepseek-v4-pro", prefs),
    "anthropic/claude-sonnet-4"
  );
});
