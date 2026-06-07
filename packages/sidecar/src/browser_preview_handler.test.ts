import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { tryHandleBrowserPreviewRequest } from "./browser_preview_handler.js";

function mockRes(): {
  res: http.ServerResponse;
  status: number;
  body: Buffer;
  headers: Record<string, string | string[] | undefined>;
} {
  const state = {
    status: 0,
    body: Buffer.alloc(0),
    headers: {} as Record<string, string | string[] | undefined>,
  };
  const res = {
    writeHead: (code: number, hdrs?: Record<string, string | number>) => {
      state.status = code;
      if (hdrs) Object.assign(state.headers, hdrs);
    },
    end: (chunk?: string | Buffer) => {
      state.body = chunk ? (Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)) : Buffer.alloc(0);
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
    get headers() {
      return state.headers;
    },
  };
}

test("tryHandleBrowserPreviewRequest serves jpeg frame", () => {
  const frame = Buffer.from([0xff, 0xd8, 0xff, 0xdb]);
  const out = mockRes();
  const req = {
    method: "GET",
    url: "/browser_preview?token=good&sessionId=s1",
  } as http.IncomingMessage;
  const handled = tryHandleBrowserPreviewRequest(req, out.res, {
    token: "good",
    resolveFrame: (id) => (id === "s1" ? frame : undefined),
  });
  assert.equal(handled, true);
  assert.equal(out.status, 200);
  assert.equal(out.headers["Content-Type"], "image/jpeg");
  assert.deepEqual(out.body, frame);
});

test("tryHandleBrowserPreviewRequest rejects bad token", () => {
  const out = mockRes();
  const req = {
    method: "GET",
    url: "/browser_preview?token=bad&sessionId=s1",
  } as http.IncomingMessage;
  const handled = tryHandleBrowserPreviewRequest(req, out.res, {
    token: "good",
    resolveFrame: () => Buffer.from("x"),
  });
  assert.equal(handled, true);
  assert.equal(out.status, 401);
});
