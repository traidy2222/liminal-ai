import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildGoogleAuthUrl } from "./oauth_broker.js";

describe("Google OAuth URL", () => {
  it("includes response_type=code in the auth URL", () => {
    const prevId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const prevSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client.apps.googleusercontent.com";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-secret";
    try {
      const url = buildGoogleAuthUrl({
        redirectUri: "http://127.0.0.1:8765/oauth/google/callback",
        scopes: ["https://www.googleapis.com/auth/drive.readonly"],
        state: "abc",
      });
      const parsed = new URL(url);
      assert.equal(parsed.searchParams.get("response_type"), "code");
      assert.ok(parsed.searchParams.get("client_id")?.includes("test-client"));
    } finally {
      if (prevId === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_ID;
      else process.env.GOOGLE_OAUTH_CLIENT_ID = prevId;
      if (prevSecret === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
      else process.env.GOOGLE_OAUTH_CLIENT_SECRET = prevSecret;
    }
  });
});
