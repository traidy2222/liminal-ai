import assert from "node:assert/strict";
import { test } from "node:test";
import { buildHostedIntegrationConnectUrl } from "./hosted_oauth_connect.js";
import {
  missingSlackScopes,
  scopesForSlackMode,
  slackHostedConnectExtra,
} from "./slack_oauth_scopes.js";

test("read_write requests history, search, and conversation write scopes", () => {
  const scopes = scopesForSlackMode("read_write");
  for (const s of [
    "channels:history",
    "search:read",
    "files:write:user",
    "im:write",
    "channels:write",
    "groups:write",
    "mpim:write",
  ]) {
    assert.ok(scopes.includes(s), `missing ${s}`);
  }
  assert.equal(scopes.length, 17);
});

test("slackHostedConnectExtra passes comma-separated scopes to hosted OAuth", () => {
  const extra = slackHostedConnectExtra("read_write");
  assert.ok(extra.scopes?.includes("search:read"));
  assert.ok(extra.scopes?.includes("channels:write"));
});

test("buildHostedIntegrationConnectUrl includes scopes query param for Slack", () => {
  const url = new URL(
    buildHostedIntegrationConnectUrl({
      provider: "slack",
      harnessRedirectUri: "http://127.0.0.1:9999/api/integrations/oauth/handoff",
      harnessState: "abc",
      siteOrigin: "https://www.vireondynamics.com",
      mode: "read_write",
      extra: slackHostedConnectExtra("read_write"),
    })
  );
  const scopes = url.searchParams.get("scopes") ?? "";
  assert.ok(scopes.includes("search:read"));
  assert.ok(scopes.includes("files:write:user"));
  assert.ok(scopes.includes("channels:write"));
});

test("missingSlackScopes flags new write scopes after app upgrade", () => {
  const legacy = ["channels:read", "channels:history", "chat:write", "users:read"];
  const miss = missingSlackScopes(legacy, "read_write");
  assert.ok(miss.includes("search:read"));
  assert.ok(miss.includes("reactions:write"));
  assert.ok(miss.includes("channels:write"));
});

test("missingSlackScopes treats files:write as satisfying files:write:user", () => {
  const granted = scopesForSlackMode("read_write").filter((s) => s !== "files:write:user");
  granted.push("files:write");
  const miss = missingSlackScopes(granted, "read_write");
  assert.equal(miss.includes("files:write:user"), false);
});
