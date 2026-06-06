import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveVisionProviderConfig,
  buildProviderRouting,
  resolveProviderRouting,
  buildOpenRouterChatRequestExtras,
  isOpenRouterStealthModel,
} from "./provider_config.js";
import { ProviderRouteState } from "./provider_route_state.js";

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

const ROUTING_ENV_KEYS = [
  "AGENT_PROVIDER_STRATEGY",
  "AGENT_PROVIDER_SORT",
  "AGENT_PROVIDER_ORDER",
  "AGENT_PROVIDER_ORDER_FAST",
  "AGENT_PROVIDER_ROUTE_AUTO",
  "AGENT_PROVIDER_ALLOW_FALLBACKS",
  "AGENT_PROVIDER_IGNORE",
  "AGENT_PROVIDER_MAX_PRICE_PROMPT",
  "AGENT_PROVIDER_MAX_PRICE_COMPLETION",
];

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
    restoreEnv(prev);
  }
});

test("buildProviderRouting ignores stale Stealth pin for Nemotron (Nvidia only)", () => {
  const prev = saveEnv(ROUTING_ENV_KEYS);
  try {
    process.env["AGENT_PROVIDER_STRATEGY"] = "price";
    process.env["AGENT_PROVIDER_ORDER"] = "Stealth";
    const routing = buildProviderRouting("nvidia/nemotron-3-ultra-550b-a55b:free");
    assert.ok(routing);
    assert.equal(routing!.only, undefined);
    assert.equal(routing!.order, undefined);
    assert.equal(routing!.sort, "price");
  } finally {
    restoreEnv(prev);
  }
});

test("buildProviderRouting pins openrouter/owl-alpha to Stealth despite DeepInfra env", () => {
  const prev = saveEnv(ROUTING_ENV_KEYS);
  try {
    process.env["AGENT_PROVIDER_STRATEGY"] = "cache_first";
    process.env["AGENT_PROVIDER_ORDER"] = "DeepInfra";
    process.env["AGENT_PROVIDER_ROUTE_AUTO"] = "1";
    process.env["AGENT_PROVIDER_ALLOW_FALLBACKS"] = "0";
    const routing = buildProviderRouting("openrouter/owl-alpha");
    assert.ok(routing);
    assert.deepEqual(routing!.order, ["Stealth"]);
    assert.equal(isOpenRouterStealthModel("openrouter/owl-alpha"), true);
  } finally {
    restoreEnv(prev);
  }
});

test("buildProviderRouting honors explicit order when route auto is off (cache_first)", () => {
  const prev = saveEnv(ROUTING_ENV_KEYS);
  try {
    process.env["AGENT_PROVIDER_STRATEGY"] = "cache_first";
    process.env["AGENT_PROVIDER_ORDER"] = "DeepInfra";
    process.env["AGENT_PROVIDER_ROUTE_AUTO"] = "0";
    const routing = buildProviderRouting("deepseek/deepseek-v4-pro");
    assert.ok(routing);
    assert.deepEqual(routing!.order, ["DeepInfra"]);
  } finally {
    restoreEnv(prev);
  }
});

test("adaptive strategy returns sort=price without order", () => {
  const prev = saveEnv(ROUTING_ENV_KEYS);
  try {
    process.env["AGENT_PROVIDER_STRATEGY"] = "adaptive";
    delete process.env["AGENT_PROVIDER_ORDER"];
    const routing = resolveProviderRouting({ modelSlug: "deepseek/deepseek-v4-pro" });
    assert.ok(routing);
    assert.equal(routing!.sort, "price");
    assert.equal(routing!.allow_fallbacks, true);
    assert.equal(routing!.order, undefined);
  } finally {
    restoreEnv(prev);
  }
});

test("adaptive ORDER env maps to only allowlist", () => {
  const prev = saveEnv(ROUTING_ENV_KEYS);
  try {
    process.env["AGENT_PROVIDER_STRATEGY"] = "adaptive";
    process.env["AGENT_PROVIDER_ORDER"] = "DeepInfra,DeepSeek";
    const routing = resolveProviderRouting({ modelSlug: "deepseek/deepseek-v4-pro" });
    assert.ok(routing);
    assert.deepEqual(routing!.only, ["DeepInfra", "DeepSeek"]);
    assert.equal(routing!.sort, "price");
    assert.equal(routing!.order, undefined);
  } finally {
    restoreEnv(prev);
  }
});

test("route state ignore merges with static AGENT_PROVIDER_IGNORE", () => {
  const prev = saveEnv(ROUTING_ENV_KEYS);
  try {
    process.env["AGENT_PROVIDER_STRATEGY"] = "adaptive";
    process.env["AGENT_PROVIDER_IGNORE"] = "Together";
    const state = new ProviderRouteState();
    state.markProviderRateLimited("DeepInfra");
    const routing = resolveProviderRouting({
      modelSlug: "deepseek/deepseek-v4-pro",
      routeState: state,
    });
    assert.ok(routing?.ignore);
    assert.deepEqual(routing!.ignore!.sort(), ["DeepInfra", "Together"]);
  } finally {
    restoreEnv(prev);
  }
});

test("buildOpenRouterChatRequestExtras applies session epoch suffix", () => {
  const state = new ProviderRouteState();
  state.markProviderRateLimited("DeepInfra", { bumpEpoch: true });
  const extras = buildOpenRouterChatRequestExtras({
    baseURL: "https://openrouter.ai/api/v1",
    modelSlug: "deepseek/deepseek-v4-pro",
    routeState: state,
    sessionId: "chat-abc",
  });
  assert.match(extras.session_id ?? "", /chat-abc#1/);
  assert.equal(extras.user, extras.session_id);
});

test("openrouter_default strategy omits provider field", () => {
  const prev = saveEnv(ROUTING_ENV_KEYS);
  try {
    process.env["AGENT_PROVIDER_STRATEGY"] = "openrouter_default";
    const routing = resolveProviderRouting({ modelSlug: "deepseek/deepseek-v4-pro" });
    assert.equal(routing, null);
    const extras = buildOpenRouterChatRequestExtras({
      baseURL: "https://openrouter.ai/api/v1",
      modelSlug: "deepseek/deepseek-v4-pro",
      sessionId: "chat-1",
    });
    assert.equal(extras.provider, undefined);
    assert.equal(extras.session_id, "chat-1");
  } finally {
    restoreEnv(prev);
  }
});

test("buildOpenRouterChatRequestExtras works for managed inference proxy base", () => {
  const prev = saveEnv(ROUTING_ENV_KEYS);
  try {
    process.env["AGENT_PROVIDER_STRATEGY"] = "price";
    const extras = buildOpenRouterChatRequestExtras({
      baseURL: "https://api.vireondynamics.com/v1/inference",
      modelSlug: "deepseek/deepseek-v4-pro",
      sessionId: "chat-managed",
    });
    assert.equal(extras.session_id, "chat-managed");
    assert.equal(extras.provider?.sort, "price");
  } finally {
    restoreEnv(prev);
  }
});

test("buildOpenRouterChatRequestExtras softens Stealth pin on managed inference", () => {
  const prev = saveEnv(ROUTING_ENV_KEYS);
  try {
    process.env["AGENT_PROVIDER_STRATEGY"] = "cache_first";
    process.env["AGENT_PROVIDER_ORDER"] = "Stealth";
    process.env["AGENT_PROVIDER_ALLOW_FALLBACKS"] = "0";
    const extras = buildOpenRouterChatRequestExtras({
      baseURL: "https://api.vireondynamics.com/v1/inference",
      modelSlug: "openrouter/owl-alpha",
      sessionId: "chat-stealth",
    });
    assert.deepEqual(extras.provider?.order, ["Stealth"]);
    assert.equal(extras.provider?.allow_fallbacks, true);
  } finally {
    restoreEnv(prev);
  }
});
