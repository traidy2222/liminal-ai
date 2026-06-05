import assert from "node:assert/strict";
import test from "node:test";
import {
  isOpenRouterApiBaseUrl,
  isStreamTransportRetryable,
  parseBaseStreamChunkTimeoutMs,
  resolveStreamChunkTimeoutMs,
} from "./stream_chunk_timeout.js";

test("parseBaseStreamChunkTimeoutMs uses harness default 120s", () => {
  assert.equal(parseBaseStreamChunkTimeoutMs(null), 120_000);
});

test("isOpenRouterApiBaseUrl", () => {
  assert.equal(isOpenRouterApiBaseUrl("https://openrouter.ai/api/v1"), true);
  assert.equal(isOpenRouterApiBaseUrl("https://api.openai.com/v1"), false);
});

test("resolveStreamChunkTimeoutMs scales for high reasoning on OpenRouter", () => {
  const ms = resolveStreamChunkTimeoutMs({
    baseURL: "https://openrouter.ai/api/v1",
    reasoningEffort: "high",
  });
  assert.equal(ms, 180_000);
});

test("resolveStreamChunkTimeoutMs quadruples during file-write sink", () => {
  const ms = resolveStreamChunkTimeoutMs({
    fileWriteSinkActive: true,
  });
  assert.equal(ms, 480_000);
});

test("resolveStreamChunkTimeoutMs raises floor for a large tool argument in flight", () => {
  const ms = resolveStreamChunkTimeoutMs({
    baseURL: "https://openrouter.ai/api/v1",
    largeToolArgInFlight: true,
  });
  // base 120s lifts to the 180s large-arg floor (no file-write sink, no high reasoning)
  assert.equal(ms, 180_000);
});

test("isStreamTransportRetryable", () => {
  assert.equal(isStreamTransportRetryable(new Error("Network connection lost.")), true);
  assert.equal(isStreamTransportRetryable(new Error("invalid_api_key")), false);
});
