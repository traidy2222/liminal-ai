import test from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { createLocalWebAuth, isLocalHarnessRequest } from "./local_auth.js";

function request(remoteAddress: string, host?: string, origin?: string, token?: string): Request {
  const headers: Record<string, string | undefined> = { host, origin, authorization: token ? `Bearer ${token}` : undefined };
  return { method: "GET", path: "/api/config", socket: { remoteAddress }, headers, query: {}, header: (name: string) => headers[name.toLowerCase()] } as unknown as Request;
}

const denied: [string, Request][] = [
  ["remote socket with forged localhost Host", request("203.0.113.10", "localhost:3001")],
  ["DNS rebinding Host on a loopback socket", request("127.0.0.1", "attacker.example:3001")],
  ["external allowed CORS origin requesting the bootstrap token", request("127.0.0.1", "127.0.0.1:3001", "https://www.vireondynamics.com")],
  ["missing Host", request("127.0.0.1")],
  ["opaque Origin", request("127.0.0.1", "localhost:3001", "null")],
  ["malformed Origin", request("127.0.0.1", "localhost:3001", "not a URL")],
  ["non-http Origin", request("127.0.0.1", "localhost:3001", "ftp://localhost")],
  ["Host containing userinfo", request("127.0.0.1", "attacker@localhost:3001")],
  ["Host containing path", request("127.0.0.1", "localhost:3001/path")],
  ["Origin containing userinfo", request("127.0.0.1", "localhost:3001", "http://attacker@localhost:3001")],
];
for (const [name, req] of denied) test(`local bootstrap rejects ${name}`, () => assert.equal(isLocalHarnessRequest(req), false));

test("local bootstrap preserves IPv4, IPv6 and the local Vite dev origin", () => {
  for (const req of [request("127.0.0.1", "localhost:3001"), request("::ffff:127.0.0.1", "127.0.0.1:3001"), request("::1", "[::1]:3001"), request("127.0.0.1", "127.0.0.1:3001", "http://localhost:5173"), request("::1", "[::1]:3001", "http://[::1]:5173")]) assert.equal(isLocalHarnessRequest(req), true);
});

test("middleware denies unauthenticated spoofed config requests but accepts a valid token", async () => {
  const previous = process.env.AGENT_WEB_TOKEN;
  let auth;
  try { process.env.AGENT_WEB_TOKEN = "synthetic-review-test-token"; auth = await createLocalWebAuth(); }
  finally { if (previous === undefined) delete process.env.AGENT_WEB_TOKEN; else process.env.AGENT_WEB_TOKEN = previous; }
  for (const [, req] of denied) {
    let status = 0, next = false;
    const res = { status(code: number) { status = code; return this; }, json() {} } as unknown as Response;
    auth.requireAuth(req, res, () => { next = true; });
    assert.equal(status, 401); assert.equal(next, false);
  }
  let next = false;
  auth.requireAuth(request("203.0.113.10", "remote.example", undefined, auth.token), {} as Response, () => { next = true; });
  assert.equal(next, true);
});
