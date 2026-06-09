import assert from "node:assert/strict";
import { test } from "node:test";
import { expandMcpToolProperties, normalizeMcpPropertyType } from "./mcp_schema_normalize.js";

test("normalizeMcpPropertyType converts integer to number", () => {
  const out = normalizeMcpPropertyType({ type: "integer", minimum: 1 });
  assert.equal(out.type, "number");
});

test("expandMcpToolProperties adds page_size alias for pageSize", () => {
  const props = expandMcpToolProperties({
    pageSize: { type: "integer", description: "Page size" },
  });
  assert.equal(props.pageSize?.type, "number");
  assert.ok(props.page_size);
  assert.ok(props.limit);
});
