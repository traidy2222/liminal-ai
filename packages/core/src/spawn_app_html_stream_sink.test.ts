import assert from "node:assert/strict";
import { test } from "node:test";
import { SpawnAppHtmlStreamSink } from "./spawn_app_html_stream_sink.js";

test("SpawnAppHtmlStreamSink repairs truncated spawn_app JSON from staged html", async () => {
  const sink = new SpawnAppHtmlStreamSink(true, null);
  const callId = "call_spawn_1";
  sink.open(callId, "spawn_app");
  const head =
    '{"type":"html","title":"Notes","props":{"html":"<main><h1>Notes</h1></main>"';
  await sink.ingestDelta(callId, "spawn_app", head);
  await sink.finalize(callId);
  const repaired = await sink.tryBuildArgsJson(callId);
  assert.ok(repaired);
  const parsed = JSON.parse(repaired!) as Record<string, unknown>;
  assert.equal(parsed["type"], "html");
  assert.equal(parsed["title"], "Notes");
  const props = parsed["props"] as Record<string, unknown>;
  assert.match(String(props["html"]), /Notes/);
  sink.discard(callId);
});

test("SpawnAppHtmlStreamSink repairs truncated update_app JSON", async () => {
  const sink = new SpawnAppHtmlStreamSink(true, null);
  const callId = "call_update_1";
  sink.open(callId, "update_app");
  const partial =
    '{"id":"notes-widget","props":{"html":"<!DOCTYPE html><html><body><h1>Hi</h1>';
  await sink.ingestDelta(callId, "update_app", partial);
  await sink.finalize(callId);
  const repaired = await sink.tryBuildArgsJson(callId);
  assert.ok(repaired, "expected repair from staged update_app html");
  const parsed = JSON.parse(repaired!) as Record<string, unknown>;
  assert.equal(parsed["id"], "notes-widget");
  const props = parsed["props"] as Record<string, unknown>;
  assert.match(String(props["html"]), /Hi/);
  sink.discard(callId);
});
