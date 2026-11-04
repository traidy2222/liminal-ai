import test from "node:test";
import assert from "node:assert/strict";
import { LocalPreview, pcmWavBase64 } from "./localPreview.js";

test("preview WAV has a valid little-endian PCM header", () => {
  const wav = Buffer.from(pcmWavBase64([new Int16Array([-32768, 32767])], 2), "base64");
  assert.equal(wav.toString("ascii", 0, 4), "RIFF"); assert.equal(wav.readUInt32LE(24), 16000);
  assert.equal(wav.readUInt32LE(40), 4); assert.equal(wav.readInt16LE(44), -32768);
});
test("preview applies backpressure, bounds the decode window, and discards stale results", async () => {
  let calls = 0, release: (text: string) => void = () => {}, bytes = 0;
  const text: string[] = [];
  const preview = new LocalPreview(async wav => {
    calls++; bytes = Buffer.from(wav, "base64").length;
    return new Promise<string>(resolve => { release = resolve; });
  }, value => text.push(value));
  preview.push(new Float32Array(30 * 16000), 16000);
  assert.equal(calls, 1); assert.equal(bytes, 44 + 12 * 32000);
  preview.push(new Float32Array(16000), 16000); assert.equal(calls, 1);
  preview.reset(); release("stale"); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(text, []);
  preview.push(new Float32Array(16000), 16000); assert.equal(calls, 2);
  release("fresh"); await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(text, ["fresh"]);
});
