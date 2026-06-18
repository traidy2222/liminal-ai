import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildTranscriptReplayFromConversation,
  conversationEntriesForHydration,
  parseSessionJsonlForReplay,
} from "./chat_session_replay.js";

describe("parseSessionJsonlForReplay", () => {
  it("reconstructs user, assistant, and tool rows", () => {
    const raw = [
      JSON.stringify({
        event: "send_start",
        turnIndex: 1,
        userMessage: "Hello",
      }),
      JSON.stringify({
        event: "tool_start",
        turnIndex: 1,
        callId: "c1",
        name: "read_file",
        args: { path: "a.ts" },
      }),
      JSON.stringify({
        event: "tool_result",
        turnIndex: 1,
        callId: "c1",
        name: "read_file",
        ok: true,
        output: "file body",
      }),
      JSON.stringify({
        event: "text_rollup",
        turnIndex: 1,
        text: "Here is the answer.",
      }),
    ].join("\n");

    const entries = parseSessionJsonlForReplay(raw);
    assert.equal(entries.length, 3);
    assert.equal(entries[0]?.kind, "user");
    assert.equal(entries[0]?.text, "Hello");
    assert.equal(entries[1]?.kind, "tool_call");
    assert.equal(entries[1]?.toolName, "read_file");
    assert.equal(entries[1]?.toolOk, true);
    assert.equal(entries[2]?.kind, "assistant");
    assert.equal(entries[2]?.text, "Here is the answer.");
  });
});

describe("buildTranscriptReplayFromConversation", () => {
  it("maps user, assistant, and tool rows from harness memory", () => {
    const entries = buildTranscriptReplayFromConversation([
      { role: "user", content: "Hello" },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          { id: "c1", type: "function", function: { name: "read_file", arguments: "{}" } },
        ],
      },
      { role: "tool", tool_call_id: "c1", content: "file body" },
      { role: "assistant", content: "Here is the answer." },
    ]);
    assert.equal(entries.length, 3);
    assert.equal(entries[0]?.kind, "user");
    assert.equal(entries[1]?.kind, "tool_call");
    assert.equal(entries[1]?.toolName, "read_file");
    assert.equal(entries[2]?.kind, "assistant");
  });

  it("skips harness-injected user lines", () => {
    const entries = buildTranscriptReplayFromConversation([
      { role: "user", content: "[REASONING BUDGET] high" },
      { role: "user", content: "Real question" },
      { role: "assistant", content: "Answer" },
    ]);
    assert.equal(entries.length, 2);
    assert.equal(entries[0]?.text, "Real question");
  });
});

describe("conversationEntriesForHydration", () => {
  it("keeps user/assistant only with tail cap", () => {
    const entries = parseSessionJsonlForReplay(
      [
        JSON.stringify({ event: "send_start", turnIndex: 1, userMessage: "A" }),
        JSON.stringify({ event: "text_rollup", turnIndex: 1, text: "B" }),
        JSON.stringify({ event: "send_start", turnIndex: 2, userMessage: "C" }),
        JSON.stringify({ event: "text_rollup", turnIndex: 2, text: "D" }),
      ].join("\n")
    );
    const conv = conversationEntriesForHydration(entries, { maxTurns: 2 });
    assert.deepEqual(conv, [
      { role: "user", content: "A" },
      { role: "assistant", content: "B" },
      { role: "user", content: "C" },
      { role: "assistant", content: "D" },
    ]);
  });
});
