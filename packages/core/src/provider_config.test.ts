import test from "node:test";
import assert from "node:assert/strict";
import { resolveVisionProviderConfig, buildProviderRouting, isOpenRouterStealthModel } from "./provider_config.js";

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

test("buildProviderRouting pins openrouter/owl-alpha to Stealth despite DeepInfra env", () => {
  const prev = {
    AGENT_PROVIDER_ORDER: process.env["AGENT_PROVIDER_ORDER"],
    AGENT_PROVIDER_ROUTE_AUTO: process.env["AGENT_PROVIDER_ROUTE_AUTO"],
    AGENT_PROVIDER_ALLOW_FALLBACKS: process.env["AGENT_PROVIDER_ALLOW_FALLBACKS"],
  };
  try {
    process.env["AGENT_PROVIDER_ORDER"] = "DeepInfra";
    process.env["AGENT_PROVIDER_ROUTE_AUTO"] = "1";
    process.env["AGENT_PROVIDER_ALLOW_FALLBACKS"] = "0";
    const routing = buildProviderRouting("openrouter/owl-alpha");
    assert.ok(routing);
    assert.deepEqual(routing!.order, ["Stealth"]);
    assert.equal(isOpenRouterStealthModel("openrouter/owl-alpha"), true);
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test("buildProviderRouting honors explicit order when route auto is off", () => {
  const prev = {
    AGENT_PROVIDER_ORDER: process.env["AGENT_PROVIDER_ORDER"],
    AGENT_PROVIDER_ROUTE_AUTO: process.env["AGENT_PROVIDER_ROUTE_AUTO"],
  };
  try {
    process.env["AGENT_PROVIDER_ORDER"] = "DeepInfra";
    process.env["AGENT_PROVIDER_ROUTE_AUTO"] = "0";
    const routing = buildProviderRouting("deepseek/deepseek-v4-pro");
    assert.ok(routing);
    assert.deepEqual(routing!.order, ["DeepInfra"]);
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
