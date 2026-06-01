import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  hasLocalProviderApiKey,
  inferencePreferManaged,
  resolveInferenceMode,
} from "./inference_provider.js";
import { HARNESS_ENV_DEFAULTS } from "./harness_default_constants.js";

describe("inference_provider", () => {
  const saved: Record<string, string | undefined> = {};

  it("defaults inference mode to auto", () => {
    assert.equal(resolveInferenceMode(null), "auto");
  });

  it("reads mode from prefs", () => {
    assert.equal(
      resolveInferenceMode({
        version: 1,
        provider: { inferenceMode: "managed" },
        updatedAt: 0,
      }),
      "managed"
    );
  });

  it("defaults prefer-managed to on from product defaults", () => {
    const saved = process.env.AGENT_INFERENCE_PREFER_MANAGED;
    delete process.env.AGENT_INFERENCE_PREFER_MANAGED;
    assert.equal(
      inferencePreferManaged(null),
      HARNESS_ENV_DEFAULTS.AGENT_INFERENCE_PREFER_MANAGED === "1"
    );
    if (saved === undefined) delete process.env.AGENT_INFERENCE_PREFER_MANAGED;
    else process.env.AGENT_INFERENCE_PREFER_MANAGED = saved;
  });

  it("detects local API keys", () => {
    saved.AGENT_API_KEY = process.env.AGENT_API_KEY;
    delete process.env.AGENT_API_KEY;
    assert.equal(hasLocalProviderApiKey(), false);
    process.env.AGENT_API_KEY = "sk-test";
    assert.equal(hasLocalProviderApiKey(), true);
    if (saved.AGENT_API_KEY === undefined) delete process.env.AGENT_API_KEY;
    else process.env.AGENT_API_KEY = saved.AGENT_API_KEY;
  });
});
