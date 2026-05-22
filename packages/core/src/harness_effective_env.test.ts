import test from "node:test";
import assert from "node:assert/strict";
import { resolveHarnessEnvRaw } from "./harness_effective_env.js";
import type { RuntimePreferences } from "./runtime_prefs.js";

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
