import test from "node:test";
import assert from "node:assert/strict";
import { runLocalAudio } from "./local_audio_runtime.js";

test("switching local audio modes waits for the old worker to release GPU memory", async () => {
  const events: string[] = [];
  let release!: () => void;
  await runLocalAudio("test-voice", async () => {
    events.push("release"); await new Promise<void>(resolve => { release = resolve; }); events.push("exited");
  }, async () => { events.push("voice"); });
  const asr = runLocalAudio("test-whisper", async () => {}, async () => { events.push("whisper"); });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ["voice", "release"]);
  release(); await asr; assert.deepEqual(events, ["voice", "release", "exited", "whisper"]);
});
test("queued cancellation returns immediately and never starts a cancelled decoder", async () => {
  let complete!: () => void, started = false;
  const first = runLocalAudio("test-busy", async () => {}, () => new Promise<void>(resolve => { complete = resolve; }));
  await new Promise(resolve => setImmediate(resolve));
  const controller = new AbortController();
  const queued = runLocalAudio("test-next", async () => {}, async () => { started = true; }, controller.signal);
  controller.abort(); await assert.rejects(queued, /cancelled/);
  complete(); await first; await new Promise(resolve => setImmediate(resolve)); assert.equal(started, false);
});

test("GPU handoff distinguishes loaded incoming weights from a cold model", async () => {
  const handoffs: unknown[] = [];
  await runLocalAudio("test-resident-voice", async (...args) => { handoffs.push(args); }, async () => {});
  await runLocalAudio("test-resident-whisper", async (...args) => { handoffs.push(args); }, async () => {}, undefined, {allowResident:true, residentReady:true});
  await runLocalAudio("test-cold-voice", async () => {}, async () => {}, undefined, {allowResident:true, residentReady:false});
  assert.deepEqual(handoffs, [["test-resident-whisper", true, true], ["test-cold-voice", true, false]]);
});
