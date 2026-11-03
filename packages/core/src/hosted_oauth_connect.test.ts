import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseHostedOAuthHandoffHttpBody, hostedOAuthHandoffCorsHeaders } from "./hosted_oauth_connect.js";
import { runHostedIntegrationConnectFlow } from "./hosted_oauth_connect.js";
import { readOAuthBundle } from "./oauth_store.js";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

describe("hosted_oauth_connect handoff parse", () => {
  it("parses form payload= base64url without Content-Type", () => {
    const inner = {
      state: "abc",
      provider: "xero",
      bundle: { accountId: "a", accessToken: "at", refreshToken: "rt" },
    };
    const encoded = Buffer.from(JSON.stringify(inner)).toString("base64url");
    const parsed = parseHostedOAuthHandoffHttpBody(`payload=${encoded}`, "");
    assert.equal(parsed.state, "abc");
    assert.equal(parsed.provider, "xero");
    assert.equal(parsed.bundle?.accountId, "a");
  });

  it("parses JSON body", () => {
    const parsed = parseHostedOAuthHandoffHttpBody(
      JSON.stringify({ state: "s", provider: "xero", bundle: { accountId: "x" } }),
      "application/json"
    );
    assert.equal(parsed.state, "s");
  });

  it("builds PNA-aware CORS headers for vireon origin", () => {
    const headers = hostedOAuthHandoffCorsHeaders("https://www.vireondynamics.com");
    assert.equal(headers["Access-Control-Allow-Origin"], "https://www.vireondynamics.com");
    assert.equal(headers["Access-Control-Allow-Private-Network"], "true");
  });
});

it("accepts the hosted form handoff only for the waiting flow's state", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "liminal-handoff-test-"));
  const previousRoot = process.env.AGENT_GLOBAL_STORAGE_ROOT;
  process.env.AGENT_GLOBAL_STORAGE_ROOT = root;
  try {
    let opened!: (url: URL) => void;
    const ready = new Promise<URL>((resolve) => { opened = resolve; });
    const flow = runHostedIntegrationConnectFlow({
      provider: "google", openBrowser: false, timeoutMs: 5000,
      onStatus: (message) => { if (message.startsWith("https://")) opened(new URL(message)); },
    });
    // Attach a rejection handler before any I/O so failures cannot leak a promise.
    void flow.catch(() => {});
    const url = await ready;
    const target = url.searchParams.get("redirect_uri")!;
    const bundle = { provider: "google", accountId: "form-fixture", accessToken: "access-fixture", refreshToken: "refresh-fixture", scopes: [] };
    const post = (state: string) => fetch(target, {
      method: "POST",
      body: new URLSearchParams({ payload: Buffer.from(JSON.stringify({ state, provider: "google", bundle })).toString("base64url") }),
    });
    const rejected = await post("wrong-state");
    assert.equal(rejected.status, 403);
    await rejected.body?.cancel();
    assert.equal(await readOAuthBundle("google", "form-fixture"), null);
    const accepted = await post(url.searchParams.get("state")!);
    assert.equal(accepted.status, 200);
    assert.match(accepted.headers.get("content-type") ?? "", /text\/html/);
    assert.match(await accepted.text(), /Connected/);
    assert.equal((await flow).accountId, "form-fixture");
    assert.equal((await readOAuthBundle("google", "form-fixture"))?.accessToken, "access-fixture");
  } finally {
    if (previousRoot === undefined) delete process.env.AGENT_GLOBAL_STORAGE_ROOT;
    else process.env.AGENT_GLOBAL_STORAGE_ROOT = previousRoot;
    assert.ok(path.resolve(root).startsWith(path.join(os.tmpdir(), "liminal-handoff-test-")));
    await rm(root, { recursive: true, force: true });
  }
});
