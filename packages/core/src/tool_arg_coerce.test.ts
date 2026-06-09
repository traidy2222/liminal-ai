import assert from "node:assert/strict";
import { test } from "node:test";
import { coerceArgsToSchema, pruneArgsToSchema } from "./tool_arg_coerce.js";

test("coerceValueToSchema coerces string to integer", () => {
  const out = coerceArgsToSchema(
    {
      type: "object",
      properties: { pageSize: { type: "integer" } },
    },
    { pageSize: "25" }
  );
  assert.equal(out.pageSize, 25);
});

test("pruneArgsToSchema drops unknown keys after alias normalization", () => {
  const schema = {
    type: "object" as const,
    properties: {
      issue: { type: "string" as const },
      issue_id: { type: "string" as const },
    },
    additionalProperties: false,
  };
  const pruned = pruneArgsToSchema(schema, {
    issue: "VIP-1",
    issue_id: "VIP-1",
    status: "Done",
  });
  assert.deepEqual(pruned, { issue: "VIP-1", issue_id: "VIP-1" });
});
