import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { AgentEmitter } from "@liminal/core";
import { AgentBridge } from "./agentBridge.js";

// Exercise the real SSE event wiring without booting tools or a model provider.
function fixture(t: TestContext) {
  const emitter = new AgentEmitter();
  const events: string[] = [];
  const bridge = Object.assign(Object.create(AgentBridge.prototype), {
    harness: { emitter, getIsRunning: () => true },
    chatId: "voice-web-test",
    sse: { send: (event: string) => events.push(event) },
    // Chat metadata does not exist, so resumeSSE's touch is a no-op.
    sseSuspended: false,
    turnEnded: true,
    harnessHeartbeatTimer: null,
    turnStartedAt: null,
    emitterDetachers: [] as Array<() => void>,
    emitInferenceWalletIfManaged: async () => {},
  });
  bridge.wireEvents();
  t.after(() => {
    bridge.stopHeartbeat();
    for (const detach of bridge.emitterDetachers) detach();
  });
  return { bridge, emitter, events };
}

test("web terminal events retire busy despite late trace and chat reactivation", async (t) => {
  const { bridge, emitter, events } = fixture(t);
  emitter.emit("send_start", { userMessage: "hello", agentDepth: 0 });
  assert.ok(events.includes("harness_running"));
  assert.equal(bridge.isTurnActive, true);
  emitter.emit("turn_end", {
    contextSnapshot: { tokenCount: 10, maxTokens: 1000, usageFraction: .01, masked: false },
    durationMs: 1,
  });
  const terminal = events.lastIndexOf("turn_end");
  assert.equal(bridge.isBusy, true, "admission still waits for cleanup");
  assert.equal(bridge.isTurnActive, false, "SSE reconnect must not reopen finished work");
  emitter.emit("text", { channel: "trace", delta: "Post-turn cleanup." });
  await bridge.resumeSSE();
  assert.deepEqual(events.slice(terminal + 1), ["text"]);
});

test("web errors retire busy and the next actual send re-arms it", (t) => {
  const { emitter, events } = fixture(t);
  for (let turn = 0; turn < 3; turn++) {
    const at = events.length;
    emitter.emit("send_start", { userMessage: "hello", agentDepth: 0 });
    assert.ok(events.slice(at).includes("harness_running"));
    emitter.emit("error", { err: new Error("Provider unavailable") });
    const terminal = events.lastIndexOf("error");
    emitter.emit("text", { channel: "trace", delta: "Failure telemetry complete." });
    assert.deepEqual(events.slice(terminal + 1), ["text"]);
  }
});
