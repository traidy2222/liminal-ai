import test from "node:test";
import assert from "node:assert/strict";
import { isStreamingToolArgsJsonComplete } from "./tool_arg_content_stream.js";
import {
  extractStreamingWritePreview,
  promoteStreamingToolCallStatus,
} from "./streaming_write_preview.js";

test("isStreamingToolArgsJsonComplete accepts closed JSON objects", () => {
  assert.equal(isStreamingToolArgsJsonComplete('{"database":"foo.i64"}'), true);
  assert.equal(isStreamingToolArgsJsonComplete('{"path":"a.ts","content":"hi"}'), true);
  assert.equal(isStreamingToolArgsJsonComplete('{"path":"a.ts","content":"hi'), false);
  assert.equal(isStreamingToolArgsJsonComplete(""), false);
});

test("promoteStreamingToolCallStatus moves MCP tools to running when args close", () => {
  const args = '{"database":"foo.i64","session_id":"abc"}';
  assert.equal(
    promoteStreamingToolCallStatus("mcp_ida_list_funcs", "streaming", args),
    "running"
  );
  assert.equal(
    promoteStreamingToolCallStatus("mcp_ida_list_funcs", "streaming", '{"database":"foo'),
    "streaming"
  );
});

test("promoteStreamingToolCallStatus keeps write tools on incomplete content", () => {
  const partial = '{"path":"a.ts","content":"hello';
  assert.equal(promoteStreamingToolCallStatus("write_file", "streaming", partial), "streaming");
  const complete = '{"path":"a.ts","content":"hello"}';
  assert.equal(promoteStreamingToolCallStatus("write_file", "streaming", complete), "running");
});

test("promoteStreamingToolCallStatus ignores non-streaming rows", () => {
  assert.equal(
    promoteStreamingToolCallStatus("web_fetch", "done", '{"url":"https://x"}'),
    "done"
  );
});

test("extractStreamingWritePreview decodes partial write_file content", () => {
  const raw = '{"path":"src/solver.ts","content":"export function main() {\\n  return 1;\\n';
  const p = extractStreamingWritePreview("write_file", raw);
  assert.ok(p);
  assert.equal(p!.label, "src/solver.ts");
  assert.equal(p!.field, "content");
  assert.match(p!.content, /export function main/);
  assert.equal(p!.incomplete, true);
  assert.ok(p!.charCount > 10);
});

test("extractStreamingWritePreview returns waiting shell for empty args", () => {
  const p = extractStreamingWritePreview("write_file", "");
  assert.ok(p);
  assert.equal(p!.charCount, 0);
  assert.equal(p!.incomplete, true);
});

test("extractStreamingWritePreview decodes partial think content", () => {
  const args = '{"content":"First thought';
  const p = extractStreamingWritePreview("think", args);
  assert.ok(p);
  assert.equal(p!.toolName, "think");
  assert.equal(p!.content, "First thought");
  assert.equal(p!.incomplete, true);
});

test("extractStreamingWritePreview handles vault_write title + content", () => {
  const raw =
    '{"title":"ChronoRoute","type":"note","content":"# Overview\\nTemporal routing\\n';
  const p = extractStreamingWritePreview("vault_write", raw);
  assert.ok(p);
  assert.equal(p!.label, "ChronoRoute");
  assert.match(p!.content, /Temporal routing/);
});
