import assert from "node:assert/strict";
import { test } from "node:test";
import { parseIntegrationNotConnectedProvider } from "./integration_connect.js";
import { missingSlackScopes } from "./slack_oauth_scopes.js";

test("parseIntegrationNotConnectedProvider extracts provider id", () => {
  const err =
    'Slack not connected. Call connect_provider({ provider: "slack", start_oauth: true }) to open sign-in in the browser, wait for completion, then retry your request.';
  assert.equal(parseIntegrationNotConnectedProvider(err), "slack");
  assert.equal(parseIntegrationNotConnectedProvider("random error"), null);
});

test("missingSlackScopes flags new write scopes after app upgrade", () => {
  const legacy = [
    "channels:read",
    "channels:history",
    "chat:write",
    "users:read",
  ];
  const miss = missingSlackScopes(legacy, "read_write");
  assert.ok(miss.includes("search:read"));
  assert.ok(miss.includes("reactions:write"));
});
