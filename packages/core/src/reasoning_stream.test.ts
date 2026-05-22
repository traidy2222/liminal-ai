import assert from "node:assert/strict";
import test from "node:test";
import { extractReasoningDeltaFromChunk } from "./reasoning_stream.js";

test("extractReasoningDeltaFromChunk reads reasoning string", () => {
  assert.equal(extractReasoningDeltaFromChunk({ reasoning: "step one" }), "step one");
});

test("extractReasoningDeltaFromChunk reads reasoning_content", () => {
  assert.equal(extractReasoningDeltaFromChunk({ reasoning_content: "alt field" }), "alt field");
});

test("extractReasoningDeltaFromChunk joins reasoning_details text", () => {
  assert.equal(
    extractReasoningDeltaFromChunk({
      reasoning_details: [{ type: "reasoning.text", text: "a" }, { text: "b" }],
    }),
    "ab"
  );
});

test("extractReasoningDeltaFromChunk returns null when empty", () => {
  assert.equal(extractReasoningDeltaFromChunk({ content: "hello" }), null);
});
