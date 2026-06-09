import test from "node:test";
import assert from "node:assert/strict";
import {
  enrichSlackScopeError,
  expectedSlackScopes,
  formatSlackScopeProbeLine,
} from "./slack_scope_probe.js";

test("expectedSlackScopes includes full Slack REST write surface", () => {
  const scopes = expectedSlackScopes();
  for (const s of [
    "search:read:user",
    "reactions:write",
    "files:write:user",
    "im:write:user",
    "channels:write",
    "groups:write",
    "mpim:write",
    "channels:history",
  ]) {
    assert.ok(scopes.includes(s), `missing ${s}`);
  }
  assert.equal(scopes.length, 17);
});

test("enrichSlackScopeError passes through non-scope errors", async () => {
  const msg = await enrichSlackScopeError({ error: "channel_not_found" });
  assert.equal(msg, "channel_not_found");
});

test("enrichSlackScopeError adds reconnect hint for missing_scope", async () => {
  const msg = await enrichSlackScopeError({ error: "missing_scope", needed: "search:read" });
  assert.match(msg, /missing_scope/);
  assert.match(msg, /search:read/);
  assert.match(msg, /connect_provider/);
});

test("formatSlackScopeProbeLine stale lists missing scopes", () => {
  const line = formatSlackScopeProbeLine({
    state: "stale",
    detail: "token has 6 scopes, harness needs 14 (8 missing)",
    missing: ["search:read", "im:write"],
  });
  assert.match(line, /stale token/);
  assert.match(line, /search:read/);
  assert.match(line, /Disconnect Slack/);
});
