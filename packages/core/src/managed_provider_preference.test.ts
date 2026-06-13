import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildManagedInferenceRequestHeaders,
  formatManagedModelProviderBadge,
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
});
