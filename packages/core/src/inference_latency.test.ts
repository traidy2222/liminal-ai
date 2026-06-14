import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import {
  InferenceLatencyTracker,
  registerInferenceLatencySink,
  clearInferenceLatencySinks,
  inferenceLatencyEnabled,
  type InferenceLatencyEvent,
} from "./inference_latency.js";

describe("InferenceLatencyTracker", () => {
  beforeEach(() => {
    clearInferenceLatencySinks();
  });

  afterEach(() => {
    clearInferenceLatencySinks();
  });

  it("tracks request start and completion", () => {
    const tracker = new InferenceLatencyTracker("test-model");
    tracker.markRequestStart();
    const event = tracker.markCompletion();
    assert.equal(event.model, "test-model");
    assert.ok(event.requestStartMs > 0);
    assert.ok(event.completionMs !== undefined);
    assert.ok(event.totalLatencyMs !== undefined);
    assert.ok(event.totalLatencyMs! >= 0);
  });

  it("tracks response start and first token", () => {
    const tracker = new InferenceLatencyTracker("model-a", "trace-123");
    tracker.markRequestStart();
    tracker.markResponseStart();
    tracker.markFirstToken();
    const event = tracker.markCompletion();
    assert.equal(event.traceId, "trace-123");
    assert.ok(event.responseStartMs !== undefined);
    assert.ok(event.firstTokenMs !== undefined);
    assert.ok(event.ttftMs !== undefined);
    assert.ok(event.ttftMs! >= 0);
  });

  it("calculates ttft from first token", () => {
    const tracker = new InferenceLatencyTracker("model-b");
    tracker.markRequestStart();
    tracker.markResponseStart();
    tracker.markFirstToken();
    const event = tracker.markCompletion();
    const expectedTtft =
      (event.firstTokenMs! - event.requestStartMs);
    assert.equal(event.ttftMs, expectedTtft);
  });

  it("does not overwrite marks when called multiple times", () => {
    const tracker = new InferenceLatencyTracker("model-c");
    tracker.markRequestStart();
    tracker.markResponseStart();
    tracker.markResponseStart();
    tracker.markFirstToken();
    tracker.markFirstToken();
    const event = tracker.markCompletion();
    assert.ok(event.responseStartMs !== undefined);
    assert.ok(event.firstTokenMs !== undefined);
  });
});

describe("InferenceLatencySink", () => {
  beforeEach(() => {
    clearInferenceLatencySinks();
  });

  afterEach(() => {
    clearInferenceLatencySinks();
  });

  it("records events via registered sinks", async () => {
    const events: InferenceLatencyEvent[] = [];
    registerInferenceLatencySink({
      record: (e) => {
        events.push(e);
      },
    });
    const tracker = new InferenceLatencyTracker("sink-test");
    tracker.markRequestStart();
    tracker.markCompletion();
    assert.equal(events.length, 1);
    assert.equal(events[0].model, "sink-test");
  });

  it("inferenceLatencyEnabled returns true when sinks registered", () => {
    assert.equal(inferenceLatencyEnabled(), false);
    registerInferenceLatencySink({ record: () => {} });
    assert.equal(inferenceLatencyEnabled(), true);
    clearInferenceLatencySinks();
    assert.equal(inferenceLatencyEnabled(), false);
  });

  it("swallows errors from sinks", () => {
    registerInferenceLatencySink({
      record: () => {
        throw new Error("boom");
      },
    });
    const tracker = new InferenceLatencyTracker("error-test");
    tracker.markRequestStart();
    assert.doesNotThrow(() => tracker.markCompletion());
  });
});
