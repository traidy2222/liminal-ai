import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSlackAuthUrl } from "./slack_oauth_broker.js";
import { scopesForSlackMode } from "./slack_oauth_scopes.js";

test("buildSlackAuthUrl uses user_scope not bot scope", () => {
  const prevId = process.env.SLACK_OAUTH_CLIENT_ID;
  const prevSecret = process.env.SLACK_OAUTH_CLIENT_SECRET;
  process.env.SLACK_OAUTH_CLIENT_ID = "test-client-id";
  process.env.SLACK_OAUTH_CLIENT_SECRET = "test-secret";
  try {
    const url = new URL(
      buildSlackAuthUrl({
        redirectUri: "http://127.0.0.1:38476/oauth/slack/callback",
        userScopes: scopesForSlackMode("read_write"),
        state: "abc",
      })
    );
    assert.equal(url.hostname, "slack.com");
    assert.equal(url.pathname, "/oauth/v2/authorize");
    assert.ok(url.searchParams.get("user_scope")?.includes("search:read"));
    assert.equal(url.searchParams.get("scope"), null);
  } finally {
    if (prevId === undefined) delete process.env.SLACK_OAUTH_CLIENT_ID;
    else process.env.SLACK_OAUTH_CLIENT_ID = prevId;
    if (prevSecret === undefined) delete process.env.SLACK_OAUTH_CLIENT_SECRET;
    else process.env.SLACK_OAUTH_CLIENT_SECRET = prevSecret;
  }
});
