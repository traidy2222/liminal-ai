import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import express from "express";
import { createLocalWebAuth } from "./local_auth.js";

test("HTTP bootstrap rejects hostile Host and Origin while preserving bearer access", async () => {
  const previous = process.env.AGENT_WEB_TOKEN;
  let auth;
  try { process.env.AGENT_WEB_TOKEN = "synthetic-http-smoke-token"; auth = await createLocalWebAuth(); }
  finally { if (previous === undefined) delete process.env.AGENT_WEB_TOKEN; else process.env.AGENT_WEB_TOKEN = previous; }
  const app = express();
  app.use(auth.requireAuth);
  app.get("/api/config", (_req, res) => res.json({ webAuthToken: auth.token }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  const status = (headers: Record<string, string> = {}) => new Promise<number>((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port, path: "/api/config", headers }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode!)); });
    req.on("error", reject); req.end();
  });
  try {
    assert.equal(await status(), 200);
    assert.equal(await status({ Host: "attacker.example" }), 401);
    assert.equal(await status({ Origin: "https://www.vireondynamics.com" }), 401);
    assert.equal(await status({ Host: "attacker.example", Authorization: `Bearer ${auth.token}` }), 200);
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
});
