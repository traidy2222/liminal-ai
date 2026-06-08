import { describe, expect, it } from "vitest";
import { resolveMicrosoftServices } from "./microsoft_connector_catalog.js";
import { missingMicrosoftScopes, normalizeMicrosoftScopes } from "./microsoft_oauth_scopes.js";
import { buildMicrosoftAuthUrl, microsoftOAuthClientConfig } from "./microsoft_oauth_broker.js";

describe("microsoft_oauth_scopes", () => {
  it("normalizeMicrosoftScopes dedupes", () => {
    expect(normalizeMicrosoftScopes(["Mail.Read", "Mail.Read", "User.Read"])).toEqual([
      "Mail.Read",
      "User.Read",
    ]);
  });

  it("Mail.ReadWrite implies Mail.Read", () => {
    const mail = resolveMicrosoftServices(["mail"]);
    const missing = missingMicrosoftScopes(["Mail.ReadWrite", "Mail.Send", "User.Read"], mail);
    expect(missing).not.toContain("Mail.Read");
  });

  it("reports missing mail send scope", () => {
    const mail = resolveMicrosoftServices(["mail"]);
    const missing = missingMicrosoftScopes(["Mail.Read"], mail);
    expect(missing.some((s) => s.includes("Mail"))).toBe(true);
  });

  it("teams preset uses delegated ChannelMessage.Send not application-only ReadWrite.All", () => {
    const teams = resolveMicrosoftServices(["teams"]);
    const scopes = teams.flatMap((p) => p.scopes);
    expect(scopes).toContain("ChannelMessage.Send");
    expect(scopes).not.toContain("ChannelMessage.ReadWrite.All");
  });
});

describe("microsoft_oauth_broker", () => {
  it("buildMicrosoftAuthUrl includes offline_access via scopes", () => {
    const prev = process.env.MICROSOFT_OAUTH_CLIENT_ID;
    process.env.MICROSOFT_OAUTH_CLIENT_ID = "test-client-id";
    try {
      if (!microsoftOAuthClientConfig()) return;
      const url = buildMicrosoftAuthUrl({
        redirectUri: "http://localhost:38476/oauth/microsoft/callback",
        scopes: ["openid", "offline_access", "Mail.Read"],
        state: "abc",
      });
      expect(url).toContain("login.microsoftonline.com");
      expect(url).toContain("client_id=test-client-id");
      expect(decodeURIComponent(url)).toContain("offline_access");
    } finally {
      if (prev === undefined) delete process.env.MICROSOFT_OAUTH_CLIENT_ID;
      else process.env.MICROSOFT_OAUTH_CLIENT_ID = prev;
    }
  });
});
