import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { tryHandleBrowserWorkspaceRequest } from "./browser_sync_handler.js";

test("browser workspace requires bearer auth and rejects browser-origin requests", async () => {
  const server = createServer((req, res) => {
    if (!tryHandleBrowserWorkspaceRequest(req, res, { token: "fixture-browser-token" })) { res.statusCode = 404; res.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/browser/control`;
  try {
    assert.equal((await fetch(url, { method: "POST", body: '{}' })).status, 401);
    assert.equal((await fetch(url, { method: "POST", headers: { Authorization: "Bearer fixture-browser-token", Origin: "https://untrusted.invalid" }, body: '{}' })).status, 401);
    assert.equal((await fetch(url, { headers: { Authorization: "Bearer fixture-browser-token" } })).status, 405);
    const response = await fetch(url, { method: "POST", headers: { Authorization: "Bearer fixture-browser-token" }, body: '{' });
    assert.equal(response.status, 400); assert.equal((await response.json()).ok, false);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
