import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAutoDreamPrompt,
  resolveAutoDreamConfig,
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

