import test from "node:test";
import assert from "node:assert/strict";
import type OpenAI from "openai";
import { StreamAccumulator } from "./streaming.js";

function chunk(args: string, initial = false): OpenAI.Chat.Completions.ChatCompletionChunk {
  return { id: "fixture", object: "chat.completion.chunk", created: 0, model: "fixture", choices: [{ index: 0, finish_reason: null, delta: { tool_calls: [{ index: 0, ...(initial ? { id: "call-1", type: "function" as const } : {}), function: { ...(initial ? { name: "read_file" } : {}), arguments: args } }] } }] };
}

test("a streamed call with no arguments is not eligible for eager dispatch", () => {
  const stream = new StreamAccumulator();
  stream.processChunk(chunk("", true));
  assert.equal(stream.tryGetCompletedCall(0), undefined);
  stream.processChunk(chunk('{"path":'));
  assert.equal(stream.tryGetCompletedCall(0), undefined);
  stream.processChunk(chunk('"README.md"}'));
  assert.deepEqual(stream.tryGetCompletedCall(0), { id: "call-1", name: "read_file", argsJson: '{"path":"README.md"}' });
});

test("an explicit empty object remains a complete no-argument call", () => {
  const stream = new StreamAccumulator();
  stream.processChunk(chunk("{}", true));
  assert.equal(stream.tryGetCompletedCall(0)?.argsJson, "{}");
  assert.equal(stream.tryGetCompletedCall(1), undefined);
});
