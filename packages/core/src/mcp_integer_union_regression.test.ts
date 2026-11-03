import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareToolArgsForValidation } from "./tool_dispatch_args.js";

test("declared integer union branches coerce numeric strings before dispatch validation", () => {
  const result = prepareToolArgsForValidation("mcp_google_ext_fixture", { count: "3" }, {
    type: "object", properties: { count: { anyOf: [{ type: "integer" }] } }, additionalProperties: false,
  });
  assert.deepEqual(result, { ok: true, args: { count: 3 } });
});
