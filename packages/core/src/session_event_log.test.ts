import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AgentEmitter } from "./events.js";
import type { ContextSnapshot } from "./types.js";
import {
  attachSessionEventLog,
  resolveSessionTextLogMode,
  sessionTraceLogEnabled,
} from "./session_event_log.js";

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

test("resolveSessionTextLogMode defaults to rollup", () => {
  const prev = process.env.AGENT_SESSION_JSONL_TEXT_LOG;
  delete process.env.AGENT_SESSION_JSONL_TEXT_LOG;
  assert.equal(resolveSessionTextLogMode(), "rollup");
  process.env.AGENT_SESSION_JSONL_TEXT_LOG = "delta";
  assert.equal(resolveSessionTextLogMode(), "delta");
  process.env.AGENT_SESSION_JSONL_TEXT_LOG = "both";
  assert.equal(resolveSessionTextLogMode(), "both");
  if (prev === undefined) delete process.env.AGENT_SESSION_JSONL_TEXT_LOG;
  else process.env.AGENT_SESSION_JSONL_TEXT_LOG = prev;
});

test("sessionTraceLogEnabled is opt-in", () => {
  const prev = process.env.AGENT_SESSION_JSONL_TRACE;
  delete process.env.AGENT_SESSION_JSONL_TRACE;
  assert.equal(sessionTraceLogEnabled(), false);
  process.env.AGENT_SESSION_JSONL_TRACE = "1";
  assert.equal(sessionTraceLogEnabled(), true);
  if (prev === undefined) delete process.env.AGENT_SESSION_JSONL_TRACE;
  else process.env.AGENT_SESSION_JSONL_TRACE = prev;
});

test("rollup mode: one text_rollup, no per-delta user text lines", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "sess-log-"));
  const prevRoot = process.env.AGENT_WORKSPACE_ROOT;
  const prevMode = process.env.AGENT_SESSION_JSONL_TEXT_LOG;
  const prevTrace = process.env.AGENT_SESSION_JSONL_TRACE;
  // Phase 1 storage split: session logs land under ~/.liminal/chats/<id>/session.jsonl.
  // Redirect AGENT_GLOBAL_STORAGE_ROOT into the test tmpdir so the assertion paths
  // are isolated. AGENT_WORKSPACE_ROOT is still set for code paths that read it,
  // though the session log no longer lives under it.
  process.env.AGENT_WORKSPACE_ROOT = dir;
  process.env.AGENT_GLOBAL_STORAGE_ROOT = dir;
  delete process.env.AGENT_SESSION_JSONL_TEXT_LOG;
  delete process.env.AGENT_SESSION_JSONL_TRACE;

  const em = new AgentEmitter();
  const detach = attachSessionEventLog(em, "test-sid");
  em.emit("send_start", { userMessage: "hello", agentDepth: 0 });
  em.emit("text", { delta: "a", channel: "user" });
  em.emit("text", { delta: "bc", channel: "user" });
  const snap: ContextSnapshot = {
    tokenCount: 10,
    maxTokens: 100,
    usageFraction: 0.1,
    masked: false,
  };
  em.emit("turn_end", { contextSnapshot: snap, durationMs: 1 });
  await sleep(80);

  const raw = await readFile(path.join(dir, "chats", "test-sid", "session.jsonl"), "utf8");
  const lines = raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { event: string; text?: string; delta?: string; channel?: string });
  detach();

  const rollup = lines.find((x) => x.event === "text_rollup");
  assert.ok(rollup, "expected text_rollup");
  assert.equal((rollup as { text?: string }).text, "abc");
  const userDeltaLines = lines.filter(
    (x) => x.event === "text" && (x.channel === "user" || x.channel === undefined)
  );
  assert.equal(userDeltaLines.length, 0);

  process.env.AGENT_WORKSPACE_ROOT = prevRoot;
  if (prevMode === undefined) delete process.env.AGENT_SESSION_JSONL_TEXT_LOG;
  else process.env.AGENT_SESSION_JSONL_TEXT_LOG = prevMode;
  if (prevTrace === undefined) delete process.env.AGENT_SESSION_JSONL_TRACE;
  else process.env.AGENT_SESSION_JSONL_TRACE = prevTrace;
  await rm(dir, { recursive: true, force: true });
});

test("delta mode: per-delta text lines", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "sess-log-delta-"));
  const prevRoot = process.env.AGENT_WORKSPACE_ROOT;
  const prevMode = process.env.AGENT_SESSION_JSONL_TEXT_LOG;
  // Phase 1 storage split: session logs land under ~/.liminal/chats/<id>/session.jsonl.
  // Redirect AGENT_GLOBAL_STORAGE_ROOT into the test tmpdir so the assertion paths
  // are isolated. AGENT_WORKSPACE_ROOT is still set for code paths that read it,
  // though the session log no longer lives under it.
  process.env.AGENT_WORKSPACE_ROOT = dir;
  process.env.AGENT_GLOBAL_STORAGE_ROOT = dir;
  process.env.AGENT_SESSION_JSONL_TEXT_LOG = "delta";

  const em = new AgentEmitter();
  const detach = attachSessionEventLog(em, "sid2");
  em.emit("send_start", { userMessage: "u", agentDepth: 0 });
  em.emit("text", { delta: "x", channel: "user" });
  em.emit("text", { delta: "y", channel: "user" });
  const snap: ContextSnapshot = {
    tokenCount: 1,
    maxTokens: 2,
    usageFraction: 0.5,
    masked: false,
  };
  em.emit("turn_end", { contextSnapshot: snap });
  await sleep(80);

  const raw = await readFile(path.join(dir, "chats", "sid2", "session.jsonl"), "utf8");
  const lines = raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { event: string; delta?: string });
  detach();
  const deltas = lines.filter((x) => x.event === "text" && x.delta);
  assert.ok(deltas.length >= 2);

  process.env.AGENT_WORKSPACE_ROOT = prevRoot;
  if (prevMode === undefined) delete process.env.AGENT_SESSION_JSONL_TEXT_LOG;
  else process.env.AGENT_SESSION_JSONL_TEXT_LOG = prevMode;
  await rm(dir, { recursive: true, force: true });
});

test("trace lines omitted unless AGENT_SESSION_JSONL_TRACE=1", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "sess-log-tr-"));
  const prevRoot = process.env.AGENT_WORKSPACE_ROOT;
  const prevTrace = process.env.AGENT_SESSION_JSONL_TRACE;
  // Phase 1 storage split: session logs land under ~/.liminal/chats/<id>/session.jsonl.
  // Redirect AGENT_GLOBAL_STORAGE_ROOT into the test tmpdir so the assertion paths
  // are isolated. AGENT_WORKSPACE_ROOT is still set for code paths that read it,
  // though the session log no longer lives under it.
  process.env.AGENT_WORKSPACE_ROOT = dir;
  process.env.AGENT_GLOBAL_STORAGE_ROOT = dir;
  delete process.env.AGENT_SESSION_JSONL_TRACE;

  const em = new AgentEmitter();
  const detach = attachSessionEventLog(em, "sid3");
  em.emit("send_start", { userMessage: "u", agentDepth: 0 });
  em.emit("text", { delta: "[trace noise]", channel: "trace" });
  const snap: ContextSnapshot = {
    tokenCount: 1,
    maxTokens: 2,
    usageFraction: 0,
    masked: false,
  };
  em.emit("turn_end", { contextSnapshot: snap });
  await sleep(80);

  let raw = await readFile(path.join(dir, "chats", "sid3", "session.jsonl"), "utf8");
  detach();
  let lines = raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { event: string; channel?: string });
  assert.equal(lines.some((x) => x.event === "text" && x.channel === "trace"), false);

  await rm(dir, { recursive: true, force: true });

  const dir2 = await mkdtemp(path.join(tmpdir(), "sess-log-tr2-"));
  process.env.AGENT_WORKSPACE_ROOT = dir2;
  process.env.AGENT_GLOBAL_STORAGE_ROOT = dir2;
  process.env.AGENT_SESSION_JSONL_TRACE = "1";
  const em2 = new AgentEmitter();
  const detach2 = attachSessionEventLog(em2, "sid4");
  em2.emit("send_start", { userMessage: "u", agentDepth: 0 });
  em2.emit("text", { delta: "t", channel: "trace" });
  em2.emit("turn_end", { contextSnapshot: snap });
  await sleep(80);
  raw = await readFile(path.join(dir2, "chats", "sid4", "session.jsonl"), "utf8");
  detach2();
  lines = raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { event: string; channel?: string });
  assert.ok(lines.some((x) => x.event === "text" && x.channel === "trace"));

  process.env.AGENT_WORKSPACE_ROOT = prevRoot;
  if (prevTrace === undefined) delete process.env.AGENT_SESSION_JSONL_TRACE;
  else process.env.AGENT_SESSION_JSONL_TRACE = prevTrace;
  await rm(dir2, { recursive: true, force: true });
});
