import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { missingGoogleScopes, missingDefaultWorkspaceScopes, normalizeGoogleScopes } from "./google_oauth_scopes.js";
import { resolveGoogleServices } from "./connector_catalog.js";

describe("google_oauth_scopes", () => {
  it("detects missing gmail API scopes but not OIDC identity scopes", () => {
    const gmail = resolveGoogleServices(["gmail"]);
    const granted = ["openid", "email", "profile", "https://www.googleapis.com/auth/drive"];
    const missing = missingGoogleScopes(granted, gmail);
    assert.ok(missing.some((s) => s.includes("gmail")));
    assert.ok(!missing.includes("email"));
    assert.ok(!missing.includes("profile"));
  });

  it("accepts userinfo URL forms as email/profile", () => {
    const gmail = resolveGoogleServices(["gmail"]);
    const granted = [
      "openid",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
      "https://www.googleapis.com/auth/gmail.modify",
    ];
    const missing = missingGoogleScopes(granted, gmail);
    assert.equal(missing.length, 0);
  });

  it("gmail.modify satisfies gmail preset scopes", () => {
    const gmail = resolveGoogleServices(["gmail"]);
    const granted = [
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.compose",
    ];
    const missing = missingGoogleScopes(granted, gmail);
    assert.ok(missing.some((s) => s.includes("gmail.modify")));
  });

  it("normalizes stored scope aliases", () => {
    const normalized = normalizeGoogleScopes([
      "https://www.googleapis.com/auth/userinfo.email",
      "profile",
    ]);
    assert.deepEqual(normalized, ["email", "profile"]);
  });

  it("reports missing default workspace API scopes only", () => {
    const missing = missingDefaultWorkspaceScopes(["openid", "email"]);
    assert.ok(missing.length > 0);
    assert.ok(!missing.includes("email"));
    assert.ok(!missing.includes("profile"));
  });

  it("calendar.events satisfies calendar.events.readonly on token", () => {
    const calendar = resolveGoogleServices(["calendar"]);
    const granted = [
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
      "https://www.googleapis.com/auth/calendar.events.freebusy",
      "https://www.googleapis.com/auth/calendar.events",
    ];
    const missing = missingGoogleScopes(granted, calendar);
    assert.equal(missing.length, 0);
  });
});
