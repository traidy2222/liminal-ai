import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseHostedOAuthHandoffHttpBody, hostedOAuthHandoffCorsHeaders } from "./hosted_oauth_connect.js";

describe("hosted_oauth_connect handoff parse", () => {
  it("parses form payload= base64url without Content-Type", () => {
    const inner = {
      state: "abc",
      provider: "xero",
      bundle: { accountId: "a", accessToken: "at", refreshToken: "rt" },
    };
    const encoded = Buffer.from(JSON.stringify(inner)).toString("base64url");
    const parsed = parseHostedOAuthHandoffHttpBody(`payload=${encoded}`, "");
    assert.equal(parsed.state, "abc");
    assert.equal(parsed.provider, "xero");
    assert.equal(parsed.bundle?.accountId, "a");
  });

  it("parses JSON body", () => {
    const parsed = parseHostedOAuthHandoffHttpBody(
      JSON.stringify({ state: "s", provider: "xero", bundle: { accountId: "x" } }),
      "application/json"
    );
    assert.equal(parsed.state, "s");
  });

  it("builds PNA-aware CORS headers for vireon origin", () => {
    const headers = hostedOAuthHandoffCorsHeaders("https://www.vireondynamics.com");
    assert.equal(headers["Access-Control-Allow-Origin"], "https://www.vireondynamics.com");
    assert.equal(headers["Access-Control-Allow-Private-Network"], "true");
  });
});
