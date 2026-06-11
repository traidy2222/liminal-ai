import test from "node:test";
import assert from "node:assert/strict";
import { resolveHarnessEnvRaw } from "./harness_effective_env.js";
import type { RuntimePreferences } from "./runtime_prefs.js";

test("resolveHarnessEnvRaw prefers provider.model over process.env and harness.env", () => {
  const prev = {
    AGENT_MODEL: process.env["AGENT_MODEL"],
    AGENT_API_BASE_URL: process.env["AGENT_API_BASE_URL"],
  };
  try {
    process.env["AGENT_MODEL"] = "openrouter/owl-alpha";
    process.env["AGENT_API_BASE_URL"] = "https://openrouter.ai/api/v1";
    const prefs: RuntimePreferences = {
      version: 1,
      updatedAt: Date.now(),
      provider: {
        model: "deepseek/deepseek-v4-pro",
        baseURL: "https://llm.cast.ai/openai/v1",
      },
    };
    assert.equal(resolveHarnessEnvRaw("AGENT_MODEL", prefs), "deepseek/deepseek-v4-pro");
    assert.equal(
      resolveHarnessEnvRaw("AGENT_API_BASE_URL", prefs),
      "https://llm.cast.ai/openai/v1"
    );
  } finally {
    if (prev.AGENT_MODEL === undefined) delete process.env["AGENT_MODEL"];
    else process.env["AGENT_MODEL"] = prev.AGENT_MODEL;
    if (prev.AGENT_API_BASE_URL === undefined) delete process.env["AGENT_API_BASE_URL"];
    else process.env["AGENT_API_BASE_URL"] = prev.AGENT_API_BASE_URL;
  }
});

test("resolveHarnessEnvRaw prefers provider.model over harness.env when env unset", () => {
  const prefs: RuntimePreferences = {
    version: 1,
    updatedAt: Date.now(),
    provider: {
      model: "deepseek/deepseek-v4-pro",
      baseURL: "https://openrouter.ai/api/v1",
    },
    harness: {
      env: {
        AGENT_MODEL: "qwen/qwen3.5-9b",
        AGENT_API_BASE_URL: "http://localhost:1234/v1",
      },
    },
  };
  assert.equal(resolveHarnessEnvRaw("AGENT_MODEL", prefs), "deepseek/deepseek-v4-pro");
  assert.equal(
    resolveHarnessEnvRaw("AGENT_API_BASE_URL", prefs),
    "https://openrouter.ai/api/v1"
  );
});
