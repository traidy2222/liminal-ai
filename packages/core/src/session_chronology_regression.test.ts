import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AgentEmitter } from "./events.js";
import { attachSessionEventLog } from "./session_event_log.js";
import {
  parseSessionJsonlForReplay,
  conversationEntriesForHydration,
} from "./chat_session_replay.js";
test("logged and replayed narration stays between tool batches", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "liminal-chronology-"));
  const previous = { ...process.env };
  Object.assign(process.env, {
    AGENT_GLOBAL_STORAGE_ROOT: root,
    AGENT_SESSION_JSONL_TEXT_LOG: "rollup",
  });
  const emitter = new AgentEmitter();
  const detach = attachSessionEventLog(emitter, "chronology");
  t.after(async () => {
    detach();
    process.env = previous;
    assert(path.basename(root).startsWith("liminal-chronology-"));
    await rm(root, { recursive: true, force: true });
  });
  emitter.emit("send_start", {
    userMessage: "Please get the weather",
    agentDepth: 0,
  });
  emitter.emit("text", { delta: "Getting the weather now.", channel: "user" });
  emitter.emit("text", {
    delta: "Private model reasoning must not become narration.",
    channel: "reasoning",
  });
  emitter.emit("tool_start", { callId: "one", name: "weather_lookup" });
  emitter.emit("text", { delta: "Waiting for the source.", channel: "user" });
  emitter.emit("tool_result", {
    callId: "one",
    name: "weather_lookup",
    args: {},
    result: { ok: true, output: "Forecast source" },
  });
  emitter.emit("text", {
    delta: "Checking the updated forecast.",
    channel: "user",
  });
  emitter.emit("tool_start", { callId: "two", name: "weather_lookup" });
  emitter.emit("tool_result", {
    callId: "two",
    name: "weather_lookup",
    args: {},
    result: { ok: true, output: "Verified weather" },
  });
  emitter.emit("text", { delta: "The final forecast.", channel: "user" });
  emitter.emit("turn_end", {
    durationMs: 10,
    contextSnapshot: {
      tokenCount: 10,
      maxTokens: 100,
      usageFraction: 0.1,
      masked: false,
    },
  });
  const file = path.join(root, "chats/chronology/session.jsonl");
  let raw = "";
  for (let i = 0; i < 100; i++) {
    try {
      raw = await readFile(file, "utf8");
      if (raw.includes('"event":"turn_end"')) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 10));
  }
  const entries = parseSessionJsonlForReplay(raw);
  assert.match(raw, /"event":"turn_end"/);
  assert.deepEqual(
    entries.map((e) => e.kind),
    ["user", "assistant", "tool_call", "assistant", "assistant", "tool_call", "assistant"],
  );
  assert.deepEqual(
    entries.filter((e) => e.kind === "assistant").map((e) => e.text),
    [
      "Getting the weather now.",
      "Waiting for the source.",
      "Checking the updated forecast.",
      "The final forecast.",
    ],
  );
});
test("hydration keeps the latest complete turns when a turn has multiple narration segments", () => {
  const entries = parseSessionJsonlForReplay(
    [
      { event: "send_start", turnIndex: 1, userMessage: "Old task" },
      { event: "text_rollup", turnIndex: 1, text: "Old reply" },
      { event: "send_start", turnIndex: 2, userMessage: "Current task" },
      { event: "text_rollup", turnIndex: 2, text: "Starting" },
      {
        event: "tool_result",
        turnIndex: 2,
        callId: "one",
        name: "inspect",
        ok: true,
        output: "Evidence",
      },
      { event: "text_rollup", turnIndex: 2, text: "Continuing" },
      { event: "text_rollup", turnIndex: 2, text: "Final answer" },
    ]
      .map((r) => JSON.stringify(r))
      .join("\n"),
  );
  assert.deepEqual(conversationEntriesForHydration(entries, { maxTurns: 1 }), [
    { role: "user", content: "Current task" },
    { role: "assistant", content: "Starting\n\nContinuing\n\nFinal answer" },
  ]);
});

test("parallel results keep their start order around intervening narration", () => {
  const raw = [
    { event: "send_start", turnIndex: 1, userMessage: "Weather" },
    { event: "text_rollup", turnIndex: 1, text: "Starting" },
    { event: "tool_start", turnIndex: 1, callId: "one", name: "lookup" },
    { event: "text_rollup", turnIndex: 1, text: "Checking another source" },
    { event: "tool_start", turnIndex: 1, callId: "two", name: "lookup" },
    {
      event: "tool_result",
      turnIndex: 1,
      callId: "two",
      ok: true,
      output: "Second",
    },
    {
      event: "tool_result",
      turnIndex: 1,
      callId: "one",
      ok: false,
      error: "First failed",
    },
    { event: "text_rollup", turnIndex: 1, text: "Final" },
  ]
    .map((row) => JSON.stringify(row))
    .join("\n");
  const entries = parseSessionJsonlForReplay(raw);
  assert.deepEqual(
    entries.map((e) => e.kind),
    ["user", "assistant", "tool_call", "assistant", "tool_call", "assistant"],
  );
  assert.equal(entries[2]?.toolOk, false);
  assert.equal(entries[2]?.toolOutput, "First failed");
  assert.equal(entries[4]?.toolOutput, "Second");
  assert.equal(
    parseSessionJsonlForReplay(raw, { maxEntries: 3 })[2]?.toolOk,
    false,
  );
  const unfinished = parseSessionJsonlForReplay(
    JSON.stringify({ event: "tool_start", callId: "pending", name: "lookup" }),
  );
  assert.deepEqual(unfinished, []);
});
