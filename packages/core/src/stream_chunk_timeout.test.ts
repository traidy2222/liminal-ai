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

test("resolveStreamChunkTimeoutMs allows long Bedrock TTFT on managed inference", () => {
  const ms = resolveStreamChunkTimeoutMs({
    baseURL: "https://api.vireondynamics.com/v1/inference",
    awaitingFirstChunk: true,
    managedProvider: "bedrock",
  });
  assert.equal(ms, 360_000);
});

test("resolveStreamChunkTimeoutMs uses shorter first-chunk floor for non-bedrock managed", () => {
  const ms = resolveStreamChunkTimeoutMs({
    baseURL: "https://api.vireondynamics.com/v1/inference",
    awaitingFirstChunk: true,
    managedProvider: "openrouter",
  });
  assert.equal(ms, 300_000);
});

test("resolveStreamChunkTimeoutMs raises inter-chunk floor for managed inference", () => {
  const ms = resolveStreamChunkTimeoutMs({
    baseURL: "https://api.vireondynamics.com/v1/inference",
    awaitingFirstChunk: false,
  });
  assert.equal(ms, 180_000);
});

test("isStreamTransportRetryable treats chunk timeout as retryable", () => {
  assert.equal(
    isStreamTransportRetryable(new Error("STREAM_CHUNK_TIMEOUT: No data received for 120s")),
    true
  );
});

test("isStreamTransportRetryable", () => {
  assert.equal(isStreamTransportRetryable(new Error("Network connection lost.")), true);
  assert.equal(isStreamTransportRetryable(new Error("invalid_api_key")), false);
});
