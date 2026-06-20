import test from "node:test";
import assert from "node:assert/strict";
import { resolveWebSearchMaxResults } from "./web_search_sizing.js";

test("resolveWebSearchMaxResults honors explicit cap", () => {
  const r = resolveWebSearchMaxResults({ query: "anything", explicitMax: 12 });
  assert.equal(r.max, 12);
  assert.equal(r.mode, "explicit");
});

test("resolveWebSearchMaxResults uses navigational cap for short queries", () => {
  const r = resolveWebSearchMaxResults({ query: "python datetime" });
  assert.equal(r.mode, "navigational");
  assert.equal(r.max, 5);
});

test("resolveWebSearchMaxResults widens broad investigative queries", () => {
  const r = resolveWebSearchMaxResults({
    query: "comprehensive overview of iran nuclear negotiations latest developments",
  });
  assert.equal(r.mode, "broad");
  assert.ok(r.max >= 10);
});

test("resolveWebSearchMaxResults tightens brief queries", () => {
  const r = resolveWebSearchMaxResults({ query: "quick tldr hydrogen symbol" });
  assert.equal(r.mode, "brief");
  assert.equal(r.max, 4);
});
