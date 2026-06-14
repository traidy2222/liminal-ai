import test from "node:test";
import assert from "node:assert/strict";
import {
  managedInferenceBaseUrl,
  resolveInferenceMode,
  resolveManagedProviderPreference,
  isInferenceBudgetExceededError,
  isManagedInferenceAuthError,
  resolveProviderConfig,
} from "@liminal/core";
import OpenAI from "openai";

function saveEnv(keys: string[]): Record<string, string | undefined> {
  const prev: Record<string, string | undefined> = {};
  for (const k of keys) {
    prev[k] = process.env[k];
  }
  return prev;
}

function restoreEnv(prev: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(prev)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

const INFERENCE_ENV_KEYS = [
  "AGENT_INFERENCE_MODE",
  "AGENT_INFERENCE_BASE_URL",
  "AGENT_API_KEY",
  "OPENROUTER_API_KEY",
];

test("managedInferenceBaseUrl returns expected base URL", () => {
  const baseUrl = managedInferenceBaseUrl();
  assert.ok(baseUrl.includes("api.vireondynamics.com"));
  assert.ok(baseUrl.includes("/inference"));
});

test("resolveInferenceMode returns valid mode", () => {
  const prev = saveEnv(INFERENCE_ENV_KEYS);
  try {
    const mode = resolveInferenceMode();
    assert.ok(["auto", "managed", "byok"].includes(mode));
  } finally {
    restoreEnv(prev);
  }
});

test("resolveInferenceMode respects AGENT_INFERENCE_MODE=byok", () => {
  const prev = saveEnv(INFERENCE_ENV_KEYS);
  try {
    process.env["AGENT_INFERENCE_MODE"] = "byok";
    const mode = resolveInferenceMode();
    assert.equal(mode, "byok");
  } finally {
    restoreEnv(prev);
  }
});

test("resolveManagedProviderPreference returns valid preference", () => {
  const pref = resolveManagedProviderPreference();
  assert.ok(["auto", "bedrock", "openrouter", "kimchi"].includes(pref));
});

test("resolveProviderConfig throws when no API key is set", () => {
  const prev = saveEnv(INFERENCE_ENV_KEYS);
  try {
    delete process.env["AGENT_API_KEY"];
    delete process.env["OPENROUTER_API_KEY"];
    assert.throws(() => resolveProviderConfig(), /No OpenRouter API key found/);
  } finally {
    restoreEnv(prev);
  }
});

test("isInferenceBudgetExceededError recognizes 402 errors", () => {
  const err = new OpenAI.APIError(402, { error: "inference_budget_exceeded" }, "Budget exceeded", {});
  assert.equal(isInferenceBudgetExceededError(err), true);
});

test("isInferenceBudgetExceededError ignores other status codes", () => {
  const err = new OpenAI.APIError(500, {}, "Internal error", {});
  assert.equal(isInferenceBudgetExceededError(err), false);
});

test("isManagedInferenceAuthError recognizes 401 auth errors", () => {
  const err = new OpenAI.APIError(401, { error: "missing auth header" }, "Unauthorized", {});
  assert.equal(isManagedInferenceAuthError(err), true);
});

test("isManagedInferenceAuthError ignores other status codes", () => {
  const err = new OpenAI.APIError(404, {}, "Not found", {});
  assert.equal(isManagedInferenceAuthError(err), false);
});
