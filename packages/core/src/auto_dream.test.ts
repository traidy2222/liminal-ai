import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAutoDreamPrompt,
  buildAutoDreamTranscriptMessage,
  resolveAutoDreamConfig,
  resolveAutoDreamInjectTranscript,
} from "./auto_dream.js";

test("resolveAutoDreamConfig defaults and clamps", () => {
  const prev = process.env["AGENT_AUTO_DREAM_MIN_HOURS"];
  const prevScan = process.env["AGENT_AUTO_DREAM_SCAN_INTERVAL_MS"];
  process.env["AGENT_AUTO_DREAM_MIN_HOURS"] = "0";
  process.env["AGENT_AUTO_DREAM_SCAN_INTERVAL_MS"] = "0";
  const cfg = resolveAutoDreamConfig();
  assert.equal(cfg.minHours, 0);
  assert.equal(cfg.scanIntervalMs, 0);
  if (prev === undefined) delete process.env["AGENT_AUTO_DREAM_MIN_HOURS"];
  else process.env["AGENT_AUTO_DREAM_MIN_HOURS"] = prev;
  if (prevScan === undefined) delete process.env["AGENT_AUTO_DREAM_SCAN_INTERVAL_MS"];
  else process.env["AGENT_AUTO_DREAM_SCAN_INTERVAL_MS"] = prevScan;
});

test("buildAutoDreamPrompt includes notes and sessions", () => {
  const prompt = buildAutoDreamPrompt({
    notesSnapshot: '{"fact:x":"y"}',
    sessions: [{ sessionId: "abc", snippet: "tool_result: ok" }],
  });
  assert.match(prompt, /Current notes snapshot/);
  assert.match(prompt, /Session abc/);
  assert.match(prompt, /upserts/);
  assert.match(prompt, /deletes/);
});

test("buildAutoDreamTranscriptMessage is system-scoped with non-user framing", () => {
  const m = buildAutoDreamTranscriptMessage("  hello world  ", 400);
  assert.equal(m.role, "system");
  assert.ok(typeof m.content === "string");
  assert.match(m.content, /not user speech/);
  assert.match(m.content, /wait for the next real user message/);
  assert.match(m.content, /hello world/);
});

test("buildAutoDreamTranscriptMessage truncates summary", () => {
  const long = "x".repeat(500);
  const m = buildAutoDreamTranscriptMessage(long, 80);
  assert.ok(typeof m.content === "string");
  assert.equal(m.content.replace(/^[\s\S]*Consolidation summary:\n/, "").length, 80);
});

test("resolveAutoDreamInjectTranscript is false when env is 0", () => {
  const prev = process.env["AGENT_AUTO_DREAM_INJECT_TRANSCRIPT"];
  process.env["AGENT_AUTO_DREAM_INJECT_TRANSCRIPT"] = "0";
  try {
    assert.equal(resolveAutoDreamInjectTranscript(null), false);
  } finally {
    if (prev === undefined) delete process.env["AGENT_AUTO_DREAM_INJECT_TRANSCRIPT"];
    else process.env["AGENT_AUTO_DREAM_INJECT_TRANSCRIPT"] = prev;
  }
});
