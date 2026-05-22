import test from "node:test";
import assert from "node:assert/strict";
import { resolveVisionProviderConfig } from "./provider_config.js";

test("resolveVisionProviderConfig uses product vision defaults, not chat model", () => {
  const prev = {
    AGENT_MODEL: process.env["AGENT_MODEL"],
    AGENT_VISION_MODEL: process.env["AGENT_VISION_MODEL"],
    AGENT_VISION_BASE_URL: process.env["AGENT_VISION_BASE_URL"],
    AGENT_API_BASE_URL: process.env["AGENT_API_BASE_URL"],
    AGENT_API_KEY: process.env["AGENT_API_KEY"],
    OPENROUTER_API_KEY: process.env["OPENROUTER_API_KEY"],
  };
  try {
    process.env["AGENT_API_KEY"] = "test-key";
    delete process.env["OPENROUTER_API_KEY"];
    process.env["AGENT_MODEL"] = "qwen/qwen3.5-9b";
    process.env["AGENT_API_BASE_URL"] = "http://localhost:1234/v1";
    delete process.env["AGENT_VISION_MODEL"];
    delete process.env["AGENT_VISION_BASE_URL"];

    const cfg = resolveVisionProviderConfig();
    assert.equal(cfg.apiKey, "test-key");
    assert.equal(cfg.baseURL, "https://openrouter.ai/api/v1");
    assert.match(cfg.model, /nemotron-nano-12b-v2-vl:free|vision|vl/i);
    assert.notEqual(cfg.model, "qwen/qwen3.5-9b");
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
