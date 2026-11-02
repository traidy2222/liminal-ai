import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSidecarArgs, buildSidecarEnv, resolveGoogleSidecarClientId } from "./google_sidecar.js";

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

test('public-client sidecar supplies signing material without copying a Google client secret', () => {
  const prevKey=process.env.FASTMCP_SERVER_AUTH_GOOGLE_JWT_SIGNING_KEY;
  const prevSecret=process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  try {
    delete process.env.FASTMCP_SERVER_AUTH_GOOGLE_JWT_SIGNING_KEY;
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    const first=buildSidecarEnv(8010),second=buildSidecarEnv(8010);
    assert.equal(typeof first.FASTMCP_SERVER_AUTH_GOOGLE_JWT_SIGNING_KEY,'string');
    assert.ok(first.FASTMCP_SERVER_AUTH_GOOGLE_JWT_SIGNING_KEY!.length>=43);
    assert.equal(first.FASTMCP_SERVER_AUTH_GOOGLE_JWT_SIGNING_KEY,second.FASTMCP_SERVER_AUTH_GOOGLE_JWT_SIGNING_KEY);
    assert.equal(first.GOOGLE_OAUTH_CLIENT_SECRET,undefined);
    assert.equal(first.MCP_ENABLE_OAUTH21,'true');
    process.env.FASTMCP_SERVER_AUTH_GOOGLE_JWT_SIGNING_KEY='explicit-signing-key-fixture';
    assert.equal(buildSidecarEnv(8010).FASTMCP_SERVER_AUTH_GOOGLE_JWT_SIGNING_KEY,'explicit-signing-key-fixture');
  } finally {
    if(prevKey===undefined)delete process.env.FASTMCP_SERVER_AUTH_GOOGLE_JWT_SIGNING_KEY;else process.env.FASTMCP_SERVER_AUTH_GOOGLE_JWT_SIGNING_KEY=prevKey;
    if(prevSecret===undefined)delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;else process.env.GOOGLE_OAUTH_CLIENT_SECRET=prevSecret;
  }
});

test('hosted OAuth sidecar can recover its public client ID from verified Google token metadata', async()=>{
  const prevId=process.env.GOOGLE_OAUTH_CLIENT_ID,prevAgentId=process.env.AGENT_GOOGLE_OAUTH_CLIENT_ID,originalFetch=globalThis.fetch;
  try {
    process.env.GOOGLE_OAUTH_CLIENT_ID='';process.env.AGENT_GOOGLE_OAUTH_CLIENT_ID='';
    globalThis.fetch=async(input)=>{
      const url=new URL(String(input));assert.equal(url.origin,'https://oauth2.googleapis.com');assert.equal(url.pathname,'/tokeninfo');assert.equal(url.searchParams.get('access_token'),'existing-google-token');
      return Response.json({aud:'12345-test.apps.googleusercontent.com'});
    };
    const id=await resolveGoogleSidecarClientId('existing-google-token');
    assert.equal(id,'12345-test.apps.googleusercontent.com');assert.equal(buildSidecarEnv(8010,undefined,id).GOOGLE_OAUTH_CLIENT_ID,id);
    globalThis.fetch=async()=>Response.json({error:'invalid_token'},{status:400});
    assert.equal(await resolveGoogleSidecarClientId('expired-token'),'');
    process.env.GOOGLE_OAUTH_CLIENT_ID='configured.apps.googleusercontent.com';
    globalThis.fetch=async()=>{throw Error('configured client must not require tokeninfo');};
    assert.equal(await resolveGoogleSidecarClientId('existing-google-token'),'configured.apps.googleusercontent.com');
  } finally {
    globalThis.fetch=originalFetch;
    if(prevId===undefined)delete process.env.GOOGLE_OAUTH_CLIENT_ID;else process.env.GOOGLE_OAUTH_CLIENT_ID=prevId;
    if(prevAgentId===undefined)delete process.env.AGENT_GOOGLE_OAUTH_CLIENT_ID;else process.env.AGENT_GOOGLE_OAUTH_CLIENT_ID=prevAgentId;
  }
});
