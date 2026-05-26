import test from "node:test";
import assert from "node:assert/strict";
import {
  buildContextKey,
  queryPatterns,
} from "./paste_pattern_store.js";
import type { PatternRecord } from "./paste_pattern_miner.js";

function fakeStore(patterns: PatternRecord[]) {
  return {
    version: 1 as const,
    refreshedAt: "2026-05-26T00:00:00.000Z",
    count: patterns.length,
    patterns,
  };
}

test("buildContextKey takes the trailing window", () => {
  assert.equal(buildContextKey(["a", "b", "c", "d"], 2), "c,d");
  assert.equal(buildContextKey(["a"], 2), "a");
  assert.equal(buildContextKey([], 2), "");
});

test("queryPatterns returns Top-k sorted by probability", () => {
  const store = fakeStore([
    { contextKey: "web_search,web_search", nextTool: "web_fetch", probability: 0.9, support: 20, hits: 18, lastSeen: "" },
    { contextKey: "web_search,web_search", nextTool: "vault_search", probability: 0.05, support: 20, hits: 1, lastSeen: "" },
    { contextKey: "web_search,web_search", nextTool: "think", probability: 0.05, support: 20, hits: 1, lastSeen: "" },
    { contextKey: "read_file,read_file", nextTool: "grep_file", probability: 0.6, support: 10, hits: 6, lastSeen: "" },
  ]);
  const top = queryPatterns(store, "web_search,web_search", { topK: 2 });
  assert.equal(top.length, 2);
  assert.equal(top[0]!.nextTool, "web_fetch");
  assert.ok(top[0]!.probability > top[1]!.probability);
});

test("queryPatterns honors minProbability", () => {
  const store = fakeStore([
    { contextKey: "ctx", nextTool: "a", probability: 0.3, support: 10, hits: 3, lastSeen: "" },
    { contextKey: "ctx", nextTool: "b", probability: 0.7, support: 10, hits: 7, lastSeen: "" },
  ]);
  const top = queryPatterns(store, "ctx", { minProbability: 0.5 });
  assert.equal(top.length, 1);
  assert.equal(top[0]!.nextTool, "b");
});

test("queryPatterns returns empty when context unknown", () => {
  const store = fakeStore([
    { contextKey: "x,y", nextTool: "a", probability: 1.0, support: 5, hits: 5, lastSeen: "" },
  ]);
  assert.deepEqual(queryPatterns(store, "y,x"), []);
  assert.deepEqual(queryPatterns(store, ""), []);
});
