import test from "node:test";
import assert from "node:assert/strict";
import { SessionToolIndex } from "./session_tool_index.js";
import { inferSpeculationArgs } from "./paste_args_inference.js";

test("infers web_fetch URL from prior web_search JSON output", () => {
  const idx = new SessionToolIndex();
  idx.add({
    callId: "call_1",
    toolName: "web_search",
    argsKey: "{}",
    output:
      'results: [{"title":"Foo","url":"https://example.com/article"}, {"url":"https://other.example/x"}]',
    at: new Date().toISOString(),
    ok: true,
  });
  const inferred = inferSpeculationArgs("web_fetch", idx);
  assert.ok(inferred);
  assert.equal(inferred!.args["url"], "https://example.com/article");
  assert.match(inferred!.source, /^web_search\(call_1\)/);
});

test("infers web_fetch URL from raw URL in plain text", () => {
  const idx = new SessionToolIndex();
  idx.add({
    callId: "call_2",
    toolName: "web_search",
    argsKey: "{}",
    output: "Top hit: https://arxiv.org/abs/2603.18897 — paste paper.",
    at: new Date().toISOString(),
    ok: true,
  });
  const inferred = inferSpeculationArgs("web_fetch", idx);
  assert.ok(inferred);
  assert.equal(inferred!.args["url"], "https://arxiv.org/abs/2603.18897");
});

test("returns null when no prior web_search exists", () => {
  const idx = new SessionToolIndex();
  assert.equal(inferSpeculationArgs("web_fetch", idx), null);
});

test("returns null when prior web_search failed", () => {
  const idx = new SessionToolIndex();
  idx.add({
    callId: "call_3",
    toolName: "web_search",
    argsKey: "{}",
    output: "(error)",
    at: new Date().toISOString(),
    ok: false,
  });
  assert.equal(inferSpeculationArgs("web_fetch", idx), null);
});

test("returns null for tools without an args inference rule", () => {
  const idx = new SessionToolIndex();
  idx.add({
    callId: "call_4",
    toolName: "web_search",
    argsKey: "{}",
    output: "https://example.com/x",
    at: new Date().toISOString(),
    ok: true,
  });
  assert.equal(inferSpeculationArgs("read_file", idx), null);
  assert.equal(inferSpeculationArgs("grep_file", idx), null);
});
