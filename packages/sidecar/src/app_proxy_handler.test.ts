import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { isProxyUrlAllowed } from "@liminal/core";
import { tryHandleAppProxyRequest } from "./app_proxy_handler.js";

function mockRes(): {
  res: http.ServerResponse;
  status: number;
  body: string;
} {
  const state = { status: 0, body: "" };
  const res = {
    writeHead: (code: number) => {
      state.status = code;
    },
    end: (chunk?: string | Buffer) => {
      state.body = chunk ? String(chunk) : "";
    },
  } as unknown as http.ServerResponse;
  return {
    res,
    get status() {
      return state.status;
    },
    get body() {
      return state.body;
    },
  };
}

test("tryHandleAppProxyRequest rejects bad token", () => {
  const out = mockRes();
  const req = {
    method: "GET",
    url: "/app_proxy?token=bad&appId=a1&url=https://example.com",
  } as http.IncomingMessage;
  const handled = tryHandleAppProxyRequest(req, out.res, { token: "good" });
  assert.equal(handled, true);
  assert.equal(out.status, 401);
});

test("isProxyUrlAllowed used for allowlist decisions", () => {
  assert.equal(isProxyUrlAllowed("https://api.open-meteo.com/v1", ["open-meteo.com"]), true);
});
