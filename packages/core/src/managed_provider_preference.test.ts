import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildManagedInferenceRequestHeaders,
  filterManagedCatalogForProvider,
  formatManagedModelProviderBadge,
  inferManagedModelProviders,
  remapManagedModelIdForProvider,
  resolveManagedProviderPreference,
  resolveModelIdForManagedProvider,
  VIREON_MANAGED_PROVIDER_HEADER,
} from "./managed_provider_preference.js";

describe("managed_provider_preference", () => {
  it("resolves preference from harness env", () => {
    assert.equal(
      resolveManagedProviderPreference({ harness: { env: { AGENT_MANAGED_PROVIDER: "bedrock" } } } as never),
      "bedrock"
    );
    assert.equal(resolveManagedProviderPreference(null), "auto");
  });

  it("emits header only for pinned providers", () => {
    assert.deepEqual(
      buildManagedInferenceRequestHeaders({
        harness: { env: { AGENT_MANAGED_PROVIDER: "openrouter" } },
      } as never),
      { [VIREON_MANAGED_PROVIDER_HEADER]: "openrouter" }
    );
    assert.deepEqual(buildManagedInferenceRequestHeaders(null), {});
  });

  it("maps display id to provider-specific slug", () => {
    const providers = [
      { provider: "bedrock" as const, id: "deepseek.v3.2" },
      { provider: "openrouter" as const, id: "deepseek/deepseek-v3.2" },
    ];
    assert.equal(
      resolveModelIdForManagedProvider("deepseek.v3.2", "openrouter", providers),
      "deepseek/deepseek-v3.2"
    );
  });

  it("formats provider badges", () => {
    assert.equal(
      formatManagedModelProviderBadge([
        { provider: "bedrock", id: "a" },
        { provider: "openrouter", id: "b" },
      ]),
      "BR+OR"
    );
  });

  it("infers providers from id shape when catalog omits providers", () => {
    assert.deepEqual(inferManagedModelProviders("us.deepseek.v3.2"), [
      { provider: "bedrock", id: "us.deepseek.v3.2" },
    ]);
    assert.deepEqual(inferManagedModelProviders("deepseek/deepseek-v3.2"), [
      { provider: "openrouter", id: "deepseek/deepseek-v3.2" },
    ]);
  });

  it("filters catalog to pinned provider", () => {
    const models = [
      {
        id: "us.deepseek.v3.2",
        label: "DeepSeek",
        providers: [
          { provider: "bedrock" as const, id: "us.deepseek.v3.2" },
          { provider: "openrouter" as const, id: "deepseek/deepseek-v3.2" },
        ],
      },
      {
        id: "anthropic.claude-3-5-sonnet",
        label: "Claude",
        providers: [{ provider: "bedrock" as const, id: "anthropic.claude-3-5-sonnet" }],
      },
    ];
    const orOnly = filterManagedCatalogForProvider(models, "openrouter");
    assert.equal(orOnly.length, 1);
    assert.equal(orOnly[0]?.id, "us.deepseek.v3.2");
    const bedrockOnly = filterManagedCatalogForProvider(models, "bedrock");
    assert.equal(bedrockOnly.length, 2);
  });

  it("remaps model id when switching provider", () => {
    const models = [
      {
        id: "us.deepseek.v3.2",
        providers: [
          { provider: "bedrock" as const, id: "us.deepseek.v3.2" },
          { provider: "openrouter" as const, id: "deepseek/deepseek-v3.2" },
        ],
      },
    ];
    assert.equal(
      remapManagedModelIdForProvider("us.deepseek.v3.2", "openrouter", models),
      "deepseek/deepseek-v3.2"
    );
  });
});
