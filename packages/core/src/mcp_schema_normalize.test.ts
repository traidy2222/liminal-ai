import assert from "node:assert/strict";
import { test } from "node:test";
import { expandMcpToolProperties, normalizeMcpPropertyType } from "./mcp_schema_normalize.js";

test("normalizeMcpPropertyType preserves integer constraints", () => {
  const out = normalizeMcpPropertyType({ type: "integer", minimum: 1 });
  assert.equal(out.type, "integer");
  assert.equal(out.minimum, 1);
});

test("expandMcpToolProperties retains the remote field set and types", () => {
  const props = expandMcpToolProperties({
    pageSize: { type: "integer", description: "Page size" },
  });
  assert.equal(props.pageSize?.type, "integer");
  assert.deepEqual(Object.keys(props), ["pageSize"]);
});
