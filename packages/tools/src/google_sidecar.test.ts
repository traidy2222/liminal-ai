import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSidecarArgs, buildSidecarEnv } from "./google_sidecar.js";

test("buildSidecarArgs does not pass unsupported --host/--port flags", () => {
  const { bin, args } = buildSidecarArgs("uvx workspace-mcp", { tools: ["docs", "sheets", "slides"] });
  assert.equal(bin, "uvx");
  assert.ok(args.includes("workspace-mcp"));
  assert.ok(args.includes("--transport"));
  assert.ok(args.includes("streamable-http"));
  assert.ok(args.includes("--tools"));
  assert.ok(args.includes("docs"));
  assert.deepEqual(
    args.filter((a) => a === "--host" || a === "--port"),
    []
  );
});

test("buildSidecarEnv sets WORKSPACE_MCP_PORT and external OAuth provider mode", () => {
  const prevId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  process.env.GOOGLE_OAUTH_CLIENT_ID = "test.apps.googleusercontent.com";
  try {
    const env = buildSidecarEnv(8010, "ya29.test-token");
    assert.equal(env.WORKSPACE_MCP_PORT, "8010");
    assert.equal(env.WORKSPACE_MCP_HOST, "127.0.0.1");
    assert.equal(env.MCP_ENABLE_OAUTH21, "true");
    assert.equal(env.EXTERNAL_OAUTH21_PROVIDER, "true");
    assert.equal(env.GOOGLE_OAUTH_CLIENT_ID, "test.apps.googleusercontent.com");
    assert.equal(env.GOOGLE_ACCESS_TOKEN, "ya29.test-token");
  } finally {
    if (prevId === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    else process.env.GOOGLE_OAUTH_CLIENT_ID = prevId;
  }
});
