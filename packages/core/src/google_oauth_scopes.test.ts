import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { missingGoogleScopes, missingDefaultWorkspaceScopes } from "./google_oauth_scopes.js";
import { resolveGoogleServices } from "./connector_catalog.js";

describe("google_oauth_scopes", () => {
  it("detects missing gmail scopes", () => {
    const gmail = resolveGoogleServices(["gmail"]);
    const granted = ["openid", "email", "profile", "https://www.googleapis.com/auth/drive"];
    const missing = missingGoogleScopes(granted, gmail);
    assert.ok(missing.some((s) => s.includes("gmail")));
  });

  it("reports missing default workspace scopes", () => {
    const missing = missingDefaultWorkspaceScopes(["openid", "email"]);
    assert.ok(missing.length > 0);
  });
});
