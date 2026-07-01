import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeMcpConnectionServices } from "./mcp_attach.js";

test("mergeMcpConnectionServices unions prior and requested ids", () => {
  assert.deepEqual(mergeMcpConnectionServices(["docs"], ["sheets"]), ["docs", "sheets"]);
  assert.deepEqual(mergeMcpConnectionServices(["mail"], ["mail", "calendar"]), ["mail", "calendar"]);
  assert.deepEqual(mergeMcpConnectionServices(undefined, ["gmail"]), ["gmail"]);
  assert.deepEqual(mergeMcpConnectionServices(["drive"], undefined), ["drive"]);
});
