import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  tryHandleTerminalAssetRequest,
  tryHandleTerminalEmbedRequest,
} from "./terminal_embed_handler.js";

const vendorDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "dist",
  "terminal-vendor"
);

test("terminal vendor assets are staged beside dist", () => {
  assert.equal(
    existsSync(path.join(vendorDir, "ghostty-web.umd.cjs")),
    true,
    "run sidecar build to stage ghostty-web"
  );
});

test("tryHandleTerminalAssetRequest serves UMD bundle", async () => {
  const server = createServer((req, res) => {
    tryHandleTerminalAssetRequest(req, res, { token: "t" });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  const res = await fetch(
    `http://127.0.0.1:${addr.port}/terminal/ghostty-web.umd.cjs`
  );
  const body = await res.text();
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  assert.equal(res.status, 200);
  assert.match(body, /GhosttyWeb/);
});

test("tryHandleTerminalEmbedRequest rejects missing token", () => {
  let status = 0;
  const res = {
    writeHead(code: number) {
      status = code;
    },
    end() {},
  };
  const handled = tryHandleTerminalEmbedRequest(
    { method: "GET", url: "/terminal/embed?sessionId=s1" } as import("node:http").IncomingMessage,
    res as import("node:http").ServerResponse,
    { token: "secret" }
  );
  assert.equal(handled, true);
  assert.equal(status, 401);
});
