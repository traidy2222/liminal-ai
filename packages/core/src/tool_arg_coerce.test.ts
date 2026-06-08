import assert from "node:assert/strict";
import { test } from "node:test";
import { coerceArgsToSchema, coerceJsonArrayValue } from "./tool_arg_coerce.js";

test("coerceArgsToSchema parses stringified JSON arrays", () => {
  const schema = {
    type: "object" as const,
    properties: {
      blocks: {
        type: "array",
        items: { type: "object" },
      },
    },
    required: ["blocks"],
  };
  const out = coerceArgsToSchema(schema, {
    blocks: '[{"type":"heading","level":1,"text":"Title"}]',
  });
  assert.ok(Array.isArray(out.blocks));
  assert.equal((out.blocks as unknown[]).length, 1);
});

test("coerceJsonArrayValue parses object JSON strings into one-element arrays", () => {
  const out = coerceJsonArrayValue('{"type":"heading","level":1,"text":"Title"}');
  assert.ok(Array.isArray(out));
  assert.equal((out as unknown[]).length, 1);
});

test("coerceArgsToSchema wraps a single object as one-element array", () => {
  const schema = {
    type: "object" as const,
    properties: {
      blocks: { type: "array", items: { type: "object" } },
    },
  };
  const out = coerceArgsToSchema(schema, {
    blocks: { type: "paragraph", text: "Hello" },
  });
  assert.ok(Array.isArray(out.blocks));
  assert.equal((out.blocks as unknown[]).length, 1);
});
