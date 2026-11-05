import test from "node:test";
import assert from "node:assert/strict";
import { AgentEmitter, type AgentHarness } from "@liminal/core";
import { SessionBridge } from "./session_bridge.js";
import type { ServerFrame } from "@liminal/protocol";

for (const fails of [false, true]) {
  test(`accepted voice send stays visible during preflight and retires on ${fails ? "failure" : "completion"}`, async (t) => {
    const emitter = new AgentEmitter();
    const frames: ServerFrame[] = [];
    let resolve!: () => void;
    let reject!: (err: Error) => void;
    const preflight = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    const harness = {
      emitter,
      getIsRunning: () => false,
      getToolExecutionScope: () => "voice-preflight-review",
      send: () => preflight,
    } as unknown as AgentHarness;
    const bridge = new SessionBridge(harness, "preflight-review", process.cwd(), (f) => frames.push(f));
    t.after(() => bridge.dispose());
    const sending = bridge.sendUserMessage("hello", { liveDictation: true });
    // No send_start yet: the harness is waiting for preflight context.
    await Promise.resolve();
    const visibleBeforeStart = frames.some((f) => f.event === "harness_running");
    if (fails) reject(new Error("Preflight failed"));
    else resolve();
    if (fails) await assert.rejects(sending, /Preflight failed/);
    else await sending;
    assert.equal(visibleBeforeStart, true, "accepted preflight must emit busy before send_start");
    assert.equal(bridge.isBusy, false);
    const end = frames.length;
    emitter.emit("text", { channel: "trace", delta: "Late cleanup" });
    assert.deepEqual(frames.slice(end).map((f) => f.event), ["text"]);
  });
}
