import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildManagedInferenceClientHeaders,
  hasLocalProviderApiKey,
  inferencePreferManaged,
  resolveInferenceMode,
  resolveManagedOpenRouterCredentials,
  resolveManagedProviderPreference,
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

  it("managed mode ignores BYOK-pinned base URL in prefs", async () => {
    const prefs = {
      version: 1 as const,
      provider: {
        inferenceMode: "managed" as const,
        baseURL: "https://openrouter.ai/api/v1",
      },
      updatedAt: 0,
    };
    assert.equal(await shouldRouteOpenRouterViaManaged(prefs), true);
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
});
