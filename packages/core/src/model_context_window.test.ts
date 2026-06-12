import assert from "node:assert/strict";
import test from "node:test";
import {
  clampMaxCompletionTokensForContext,
  isContextLengthExceededError,
  resolveModelContextWindowTokens,
} from "./model_context_window.js";

test("resolveModelContextWindowTokens maps Bedrock Claude slugs to ~202752", () => {
  assert.equal(resolveModelContextWindowTokens("anthropic.claude-opus-4-8"), 202_752);
  assert.equal(resolveModelContextWindowTokens("anthropic/claude-sonnet-4.6"), 202_752);
});

test("clampMaxCompletionTokensForContext shrinks output when prompt is huge", () => {
  const clamped = clampMaxCompletionTokensForContext(186_753, 10_000, 202_752);
  assert.ok(clamped !== undefined);
  assert.ok(clamped! < 10_000);
  assert.ok(clamped! + 186_753 < 202_752);
});

test("isContextLengthExceededError detects Bedrock validation bodies", () => {
  const err = new Error(
    'HTTP 400 from Error: {"code":"validation_error","message":"maximum context length is 202752 tokens"}'
  );
  assert.equal(isContextLengthExceededError(err), true);
});
