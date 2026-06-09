import assert from "node:assert/strict";
import { test } from "node:test";
import { buildHostedIntegrationConnectUrl } from "./hosted_oauth_connect.js";
import {
  missingSlackScopes,
  scopesForSlackMode,
  slackHostedConnectExtra,
  slackRestToolScopeUnion,
  SLACK_API_METHOD_SCOPES,
} from "./slack_oauth_scopes.js";

test("slackRestToolScopeUnion matches read_write OAuth request set", () => {
  const union = new Set(slackRestToolScopeUnion());
  for (const s of scopesForSlackMode("read_write")) {
    assert.ok(union.has(s), `method union missing ${s}`);
  }
  assert.equal(scopesForSlackMode("read_write").length, 17);
});

test("read_write requests method-doc scopes user reported missing", () => {
  const scopes = scopesForSlackMode("read_write");
  for (const s of [
    "search:read",
    "reactions:write",
    "files:write",
    "im:write",
    "channels:write",
    "groups:write",
    "mpim:write",
    "channels:history",
  ]) {
    assert.ok(scopes.includes(s), `missing ${s}`);
  }
});

test("SLACK_API_METHOD_SCOPES documents search and open_dm write scopes", () => {
  assert.deepEqual(SLACK_API_METHOD_SCOPES["search.messages"], ["search:read"]);
  assert.ok(SLACK_API_METHOD_SCOPES["conversations.open"]?.includes("im:write"));
  assert.ok(SLACK_API_METHOD_SCOPES["files.getUploadURLExternal"]?.includes("files:write"));
  assert.ok(SLACK_API_METHOD_SCOPES["files.completeUploadExternal"]?.includes("files:write"));
});

test("slackHostedConnectExtra passes user_scope for Slack OAuth v2", () => {
  const extra = slackHostedConnectExtra("read_write");
  assert.equal(extra.user_scope, extra.scopes);
  assert.ok(extra.user_scope?.includes("search:read"));
  assert.ok(extra.user_scope?.includes("reactions:write"));
  assert.ok(extra.user_scope?.includes("im:write"));
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
  assert.ok(scopes.includes("files:write"));
  assert.ok(scopes.includes("channels:write"));
});

test("missingSlackScopes flags new write scopes after app upgrade", () => {
  const legacy = ["channels:read", "channels:history", "chat:write", "users:read"];
  const miss = missingSlackScopes(legacy, "read_write");
  assert.ok(miss.includes("search:read"));
  assert.ok(miss.includes("reactions:write"));
  assert.ok(miss.includes("channels:write"));
});

test("missingSlackScopes treats granular :user aliases as satisfied", () => {
  const granted = scopesForSlackMode("read_write").filter((s) => s !== "search:read" && s !== "im:write");
  granted.push("search:read:user", "im:write:user");
  const miss = missingSlackScopes(granted, "read_write");
  assert.equal(miss.includes("search:read"), false);
  assert.equal(miss.includes("im:write"), false);
});

test("missingSlackScopes treats files:write:user as satisfying files:write", () => {
  const granted = scopesForSlackMode("read_write").filter((s) => s !== "files:write");
  granted.push("files:write:user");
  const miss = missingSlackScopes(granted, "read_write");
  assert.equal(miss.includes("files:write"), false);
});
