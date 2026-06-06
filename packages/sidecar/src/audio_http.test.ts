import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { tryHandleAudioRequest } from "./audio_http.js";
import type { SessionBridge } from "./session_bridge.js";

function mockRes(): {
  res: http.ServerResponse;
  status: number;
  body: string;
  headers: Record<string, string | string[] | undefined>;
} {
  const state = { status: 0, body: "", headers: {} as Record<string, string | string[] | undefined> };
  const res = {
    writeHead: (code: number, hdrs?: Record<string, string>) => {
      state.status = code;
      if (hdrs) Object.assign(state.headers, hdrs);
    },
    end: (chunk?: string | Buffer) => {
      state.body = chunk ? String(chunk) : "";
    },
  } as unknown as http.ServerResponse;
  return { res, get status() { return state.status; }, get body() { return state.body; }, get headers() { return state.headers; } };
}

test("tryHandleAudioRequest: rejects bad token", () => {
  const out = mockRes();
  const req = { method: "GET", url: "/api/tts/clip/abc?token=wrong" } as http.IncomingMessage;
  const handled = tryHandleAudioRequest(req, out.res, {
    token: "good-token",
    resolveBridge: () => undefined,
  });
  assert.equal(handled, true);
  assert.equal(out.status, 401);
});

test("tryHandleAudioRequest: 404 when chat bridge missing", () => {
  const out = mockRes();
  const req = { method: "GET", url: "/api/tts/clip/abc?token=good-token&chatId=x" } as http.IncomingMessage;
  const handled = tryHandleAudioRequest(req, out.res, {
    token: "good-token",
    resolveBridge: () => undefined,
  });
  assert.equal(handled, true);
  assert.equal(out.status, 404);
});

test("tryHandleAudioRequest: clip not found returns 404 JSON", async () => {
  const out = mockRes();
  const req = { method: "GET", url: "/api/tts/clip/missing?token=good-token&chatId=c1" } as http.IncomingMessage;
  const bridge = {
    chatId: "c1",
    harness: { getRuntimePreferences: () => null },
  } as unknown as SessionBridge;
  const handled = tryHandleAudioRequest(req, out.res, {
    token: "good-token",
    resolveBridge: () => bridge,
  });
  assert.equal(handled, true);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(out.status, 404);
  assert.match(out.body, /not found/);
});

test("tryHandleAudioRequest: ignores unrelated paths", () => {
  const out = mockRes();
  const req = { method: "GET", url: "/media?token=good-token" } as http.IncomingMessage;
  const handled = tryHandleAudioRequest(req, out.res, {
    token: "good-token",
    resolveBridge: () => undefined,
  });
  assert.equal(handled, false);
});
