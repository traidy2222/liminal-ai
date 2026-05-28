import test from "node:test";
import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { resolveWorkspaceRoot } from "./workspace_root.js";
import { FileWriteStreamSink } from "./file_write_stream_sink.js";

test("salvagePartialToTarget copies staged bytes before discard removes entry", async () => {
  const sink = new FileWriteStreamSink(true, 5);
  const callId = "test-salvage-1";
  const rel = ".agent_artifacts/sink-salvage-test.txt";
  const abs = path.resolve(resolveWorkspaceRoot(), rel);
  await rm(abs, { force: true });
  const delta = JSON.stringify({ path: rel, content: "hello-world-staged" });
  await sink.ingestDelta(callId, "write_file", delta);
  const salvaged = await sink.salvagePartialToTarget(callId);
  assert.ok(salvaged);
  assert.equal(salvaged!.targetPath, abs);
  assert.ok(salvaged!.bytes >= 10);
  const onDisk = await readFile(abs, "utf8");
  assert.ok(onDisk.includes("hello-world"));
  sink.discard(callId);
  await rm(abs, { force: true });
});

test("FileWriteStreamSink writes staged content for large payload", async () => {
  const sink = new FileWriteStreamSink(true, 10);
  const callId = "test-sink-1";
  sink.open(callId, "write_file");
  const chunk = "x".repeat(20);
  const delta = JSON.stringify({ path: ".agent_artifacts/sink-test.txt", content: chunk });
  await sink.ingestDelta(callId, "write_file", delta);
  await sink.finalize(callId);
  const taken = sink.takeForDispatch(callId);
  assert.ok(taken);
  const staged = await readFile(taken!.stagingPath, "utf8");
  assert.ok(staged.length >= 20);
  const abs = path.resolve(resolveWorkspaceRoot(), ".agent_artifacts/sink-test.txt");
  await rm(taken!.stagingPath, { force: true });
  await rm(abs, { force: true });
});
