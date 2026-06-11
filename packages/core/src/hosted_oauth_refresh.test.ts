import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { refreshOAuthViaVireonHostedBroker } from "./hosted_oauth_refresh.js";

describe("hosted_oauth_refresh", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.AGENT_LICENSE_KEY;
  });

  it("refreshes without license when refresh_token is present", async () => {
    let authHeader = "";
    globalThis.fetch = mock.fn(async (_url: string, init?: RequestInit) => {
      authHeader = (init?.headers as Record<string, string>)?.Authorization ?? "";
      return new Response(
        JSON.stringify({
          access_token: "new-access",
          refresh_token: "new-refresh",
          expires_at: Date.now() + 3_600_000,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const result = await refreshOAuthViaVireonHostedBroker("xero", "rt-secret");
    assert.ok(result);
    assert.equal(result?.accessToken, "new-access");
    assert.equal(authHeader, "");
  });
});
