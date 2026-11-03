import test from "node:test";
import assert from "node:assert/strict";
import { groupIntoChatTurns, sealAssistantSegment } from "./chatTurnLayout.js";
import type { MessageEntry } from "./useSSE.js";
const tool = (id: string): MessageEntry => ({
  kind: "tool_call",
  callId: id,
  name: "weather_lookup",
  status: "done",
  argsJson: "{}",
  startedAt: 0,
});
test("weather narration and tool batches remain separate chronological display blocks", () => {
  const input: MessageEntry[] = [
    { kind: "user", text: "Please get the weather" },
    { kind: "assistant", text: "Getting the weather now.", streaming: false },
    tool("one"),
    tool("two"),
    {
      kind: "assistant",
      text: "Checking the updated forecast.",
      streaming: false,
    },
    tool("three"),
    { kind: "assistant", text: "The final forecast.", streaming: false },
  ];
  const turns = groupIntoChatTurns(input, true);
  assert.deepEqual(
    turns.map((t) => t.finalReply?.text),
    [
      "Getting the weather now.",
      "Checking the updated forecast.",
      "The final forecast.",
    ],
  );
  assert.deepEqual(
    turns.map((t) => t.working.filter((x) => x.kind === "tool_call").length),
    [0, 2, 1],
  );
  assert.deepEqual(
    turns.map((t) => t.isActive),
    [false, false, true],
  );
  assert.equal(turns.filter((t) => t.user).length, 1);
});
test("sealing keeps narration visible and leaves the previous state immutable", () => {
  const input: MessageEntry[] = [
    { kind: "assistant", text: "Looking up the weather.", streaming: true },
  ];
  const sealed = sealAssistantSegment(input);
  assert.deepEqual(sealed, [
    { kind: "assistant", text: "Looking up the weather.", streaming: false },
  ]);
  assert.equal(
    (input[0] as Extract<MessageEntry, { kind: "assistant" }>).streaming,
    true,
  );
  const turns = groupIntoChatTurns(
    [...sealed, { kind: "working_state", preview: {} }] as MessageEntry[],
    false,
  );
  assert.equal(turns.length, 1);
  assert.equal(turns[0]?.finalReply?.text, "Looking up the weather.");
});
test("completed progress notes from older web state stay before their tool activity", () => {
  const turns = groupIntoChatTurns(
    [
      { kind: "user", text: "Weather" },
      { kind: "working_note", text: "Looking it up.", streaming: false },
      tool("one"),
      { kind: "assistant", text: "Sunny.", streaming: false },
    ],
    false,
  );
  assert.deepEqual(
    turns.map((t) => t.finalReply?.text),
    ["Looking it up.", "Sunny."],
  );
});
