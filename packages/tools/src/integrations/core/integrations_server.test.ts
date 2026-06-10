import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseAuthBody } from "./integrations_server.js";

describe("integrations_server", () => {
  it("parseAuthBody bearer", () => {
    const a = parseAuthBody({ kind: "bearer", envVar: "TOKEN" });
    assert.equal(a.kind, "bearer");
    if (a.kind === "bearer") assert.equal(a.envVar, "TOKEN");
  });

  it("parseAuthBody none when missing env", () => {
    assert.deepEqual(parseAuthBody({ kind: "bearer" }), { kind: "none" });
    assert.deepEqual(parseAuthBody(undefined), { kind: "none" });
  });

  it("parseAuthBody header", () => {
    const a = parseAuthBody({ kind: "header", envVar: "K", headerName: "X-Key" });
    assert.equal(a.kind, "header");
    if (a.kind === "header") {
      assert.equal(a.envVar, "K");
      assert.equal(a.headerName, "X-Key");
    }
  });
});
