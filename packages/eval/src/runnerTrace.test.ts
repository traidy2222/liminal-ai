import test from "node:test";
import assert from "node:assert/strict";
import { traceGetFinalAssistantText, type TraceEvent } from "./runner.js";

test("final reply collects unlabelled assistant deltas after the last user message", () => {
  const text = (delta: string, channel?: string): TraceEvent => ({ type: "text", payload: { delta, ...(channel ? { channel } : {}) }, at: 0 });
  assert.equal(traceGetFinalAssistantText([
    text("old reply"), text("question", "user"), text("internal", "trace"),
    text("thinking", "reasoning"), text("Hello, "), text("world!"),
  ]), "Hello, world!");
  assert.equal(traceGetFinalAssistantText([text("question", "user")]), null);
});
