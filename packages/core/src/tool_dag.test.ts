import test from "node:test";
import assert from "node:assert/strict";
import { ToolDag } from "./tool_dag.js";

test("ToolDag returns single batch when empty", () => {
  const dag = new ToolDag();
  assert.deepEqual(dag.topologicalBatches(["a", "b", "c"]), [["a", "b", "c"]]);
});

test("ToolDag orders dependent calls into batches", () => {
  const dag = new ToolDag();
  dag.register({ deps: { c: ["a", "b"] } });
  const batches = dag.topologicalBatches(["a", "b", "c"]);
  assert.equal(batches.length, 2);
  assert.ok(batches[0]?.includes("a"));
  assert.ok(batches[0]?.includes("b"));
  assert.deepEqual(batches[1], ["c"]);
});

test("ToolDag injectResolvedDeps merges prerequisite outputs", () => {
  const dag = new ToolDag();
  dag.register({ deps: { "call-c": ["call-a", "call-b"] } });
  const withDeps = dag.injectResolvedDeps({ path: "out.txt" }, "call-c", new Map([
    ["call-a", { ok: true, output: "alpha" }],
    ["call-b", { ok: false, output: "", error: "fail" }],
  ]));
  assert.ok(Array.isArray(withDeps.__resolved_deps));
  assert.equal((withDeps.__resolved_deps as { length: number }).length, 2);
  assert.equal((withDeps.__resolved_deps as { callId: string }[])[0]?.callId, "call-a");
});
