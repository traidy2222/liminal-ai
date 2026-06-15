import { describe, it } from "node:test";
import assert from "node:assert/strict";
import OpenAI from "openai";
import {
  buildByokRoutingPatchForModel,
  buildManagedInferenceClientHeaders,
  filterManagedInferenceCatalog,
  hasLocalProviderApiKey,
  inferencePreferManaged,
  isManagedInferenceAuthError,
  resolveInferenceMode,
  resolveManagedOpenRouterCredentials,
  resolveManagedProviderPreference,
  resolveManagedModelForProviderPreference,
  shouldRouteOpenRouterViaManaged,
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

  it("defaults managed provider preference to auto", () => {
    assert.equal(resolveManagedProviderPreference(null), "auto");
    assert.deepEqual(buildManagedInferenceClientHeaders(null), {
      "x-vireon-managed-provider": "auto",
    });
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

  it("buildByokRoutingPatchForModel switches managed auto to byok for openrouter slugs", () => {
    saved.AGENT_API_KEY = process.env.AGENT_API_KEY;
    delete process.env.AGENT_API_KEY;
    const patch = buildByokRoutingPatchForModel("openrouter/free", {
      version: 1,
      provider: { inferenceMode: "managed" },
      harness: { env: { AGENT_INFERENCE_MODE: "managed" } },
      updatedAt: 0,
    });
    assert.ok(patch);
    assert.equal(patch?.provider?.inferenceMode, "byok");
    assert.equal(patch?.harness?.env?.AGENT_MODEL, "openrouter/free");
    assert.equal(patch?.harness?.env?.AGENT_INFERENCE_MODE, "byok");
    const n2 = buildByokRoutingPatchForModel("nex-agi/nex-n2-pro:free", {
      version: 1,
      provider: { inferenceMode: "auto" },
      updatedAt: 0,
    });
    assert.equal(n2?.provider?.inferenceMode, "byok");
    assert.equal(n2?.harness?.env?.AGENT_MODEL, "nex-agi/nex-n2-pro:free");
    if (saved.AGENT_API_KEY === undefined) delete process.env.AGENT_API_KEY;
    else process.env.AGENT_API_KEY = saved.AGENT_API_KEY;
  });

  it("managed mode requires entitlement even with pinned base URL", async () => {
    const prefs = {
      version: 1 as const,
      provider: {
        inferenceMode: "managed" as const,
        baseURL: "https://openrouter.ai/api/v1",
      },
      updatedAt: 0,
    };
    // Without a valid license token, managed mode returns false (entitlement check fails)
    assert.equal(await shouldRouteOpenRouterViaManaged(prefs), false);
  });

  it("shouldRouteOpenRouterViaManaged is false in byok mode", async () => {
    const route = await shouldRouteOpenRouterViaManaged({
      version: 1,
      provider: { inferenceMode: "byok" },
      updatedAt: 0,
    });
    assert.equal(route, false);
  });

  it("resolveManagedOpenRouterCredentials returns byok route with env key", async () => {
    saved.AGENT_API_KEY = process.env.AGENT_API_KEY;
    saved.AGENT_INFERENCE_MODE = process.env.AGENT_INFERENCE_MODE;
    process.env.AGENT_API_KEY = "sk-test-byok";
    process.env.AGENT_INFERENCE_MODE = "byok";
    const creds = await resolveManagedOpenRouterCredentials({
      version: 1,
      provider: { inferenceMode: "byok" },
      updatedAt: 0,
    });
    assert.equal(creds.route, "byok");
    assert.equal(creds.apiKey, "sk-test-byok");
    assert.ok(creds.baseURL.includes("openrouter") || creds.baseURL.includes("api"));
    if (saved.AGENT_API_KEY === undefined) delete process.env.AGENT_API_KEY;
    else process.env.AGENT_API_KEY = saved.AGENT_API_KEY;
    if (saved.AGENT_INFERENCE_MODE === undefined) delete process.env.AGENT_INFERENCE_MODE;
    else process.env.AGENT_INFERENCE_MODE = saved.AGENT_INFERENCE_MODE;
  });

  it("filterManagedInferenceCatalog keeps all models in auto mode", () => {
    const models = [
      {
        id: "anthropic.claude-sonnet-4-6",
        label: "Claude Sonnet",
        family: "anthropic",
        providers: [
          { provider: "bedrock" as const, id: "anthropic.claude-sonnet-4-6" },
          { provider: "openrouter" as const, id: "anthropic/claude-sonnet-4-6" },
        ],
      },
      {
        id: "deepseek/deepseek-v4-pro",
        label: "DeepSeek V4 Pro",
        family: "deepseek",
        providers: [{ provider: "openrouter" as const, id: "deepseek/deepseek-v4-pro" }],
      },
    ];
    assert.equal(filterManagedInferenceCatalog(models, "auto").length, 2);
  });

  it("filterManagedInferenceCatalog narrows dual-provider rows to bedrock ids", () => {
    const models = [
      {
        id: "anthropic.claude-sonnet-4-6",
        label: "Claude Sonnet",
        family: "anthropic",
        providers: [
          { provider: "bedrock" as const, id: "anthropic.claude-sonnet-4-6" },
          { provider: "openrouter" as const, id: "anthropic/claude-sonnet-4-6" },
        ],
      },
      {
        id: "deepseek/deepseek-v4-pro",
        label: "DeepSeek V4 Pro",
        family: "deepseek",
        providers: [{ provider: "openrouter" as const, id: "deepseek/deepseek-v4-pro" }],
      },
    ];
    const bedrock = filterManagedInferenceCatalog(models, "bedrock");
    assert.equal(bedrock.length, 1);
    assert.equal(bedrock[0]?.id, "anthropic.claude-sonnet-4-6");
    assert.deepEqual(bedrock[0]?.providers, [
      { provider: "bedrock", id: "anthropic.claude-sonnet-4-6" },
    ]);
  });

  it("filterManagedInferenceCatalog uses shape fallback when providers missing", () => {
    const models = [
      {
        id: "meta.llama3-70b-instruct-v1:0",
        label: "Llama 3 70B",
        family: "meta",
      },
      {
        id: "deepseek/deepseek-v4-pro",
        label: "DeepSeek V4 Pro",
        family: "deepseek",
      },
    ];
    const bedrock = filterManagedInferenceCatalog(models, "bedrock");
    assert.equal(bedrock.length, 1);
    assert.equal(bedrock[0]?.id, "meta.llama3-70b-instruct-v1:0");
    const openrouter = filterManagedInferenceCatalog(models, "openrouter");
    assert.equal(openrouter.length, 1);
    assert.equal(openrouter[0]?.id, "deepseek/deepseek-v4-pro");
  });

  it("resolveManagedModelForProviderPreference keeps regional Bedrock id in auto mode", () => {
    const catalog = [
      {
        id: "global.anthropic.claude-sonnet-4-6",
        label: "Claude Sonnet 4.6 (Global)",
        family: "anthropic",
        providers: [{ provider: "bedrock" as const, id: "global.anthropic.claude-sonnet-4-6" }],
      },
      {
        id: "anthropic.claude-opus-4-8",
        label: "Claude Opus 4.8",
        family: "anthropic",
        providers: [{ provider: "bedrock" as const, id: "anthropic.claude-opus-4-8" }],
      },
    ];
    assert.equal(
      resolveManagedModelForProviderPreference(
        "global.anthropic.claude-sonnet-4-6",
        catalog,
        "auto"
      ),
      "global.anthropic.claude-sonnet-4-6"
    );
  });

  it("resolveManagedModelForProviderPreference maps regional id to unprefixed bedrock twin", () => {
    const catalog = [
      {
        id: "anthropic.claude-sonnet-4-6",
        label: "Claude Sonnet 4.6",
        family: "anthropic",
        providers: [
          { provider: "bedrock" as const, id: "anthropic.claude-sonnet-4-6" },
          { provider: "openrouter" as const, id: "anthropic/claude-sonnet-4.6" },
        ],
      },
      {
        id: "global.anthropic.claude-sonnet-4-6",
        label: "Claude Sonnet 4.6 (Global)",
        family: "anthropic",
        providers: [{ provider: "bedrock" as const, id: "global.anthropic.claude-sonnet-4-6" }],
      },
    ];
    assert.equal(
      resolveManagedModelForProviderPreference(
        "global.anthropic.claude-sonnet-4-6",
        catalog,
        "openrouter"
      ),
      "anthropic/claude-sonnet-4.6"
    );
  });

  it("isManagedInferenceAuthError matches expired session JWT (HTTP 401)", () => {
    const err = new OpenAI.APIError(401, { message: "expired" }, "expired", undefined);
    assert.equal(isManagedInferenceAuthError(err), true);
  });
});
