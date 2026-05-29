import test from "node:test";
import assert from "node:assert/strict";
import { parseRerankScores } from "./recall_rerank.js";

const ids = new Set(["fact:a", "fact:b", "fact:c"]);

test("parses {scores:[{id,relevance}]} and clamps to 0-1", () => {
  const m = parseRerankScores(
    { scores: [{ id: "fact:a", relevance: 0.9 }, { id: "fact:b", relevance: 0.1 }] },
    ids
  );
  assert.equal(m.get("fact:a"), 0.9);
  assert.equal(m.get("fact:b"), 0.1);
});

test("drops ids not in the candidate set (no phantom injection)", () => {
  const m = parseRerankScores({ scores: [{ id: "evil:hallucinated", relevance: 1 }] }, ids);
  assert.equal(m.size, 0);
});

test("normalizes 0-10 and 0-100 scales down to 0-1", () => {
  const m = parseRerankScores(
    { scores: [{ id: "fact:a", relevance: 8 }, { id: "fact:b", relevance: 80 }] },
    ids
  );
  assert.equal(m.get("fact:a"), 0.8);
  assert.equal(m.get("fact:b"), 0.8);
});

test("accepts alternate keys: results/ranking, score/rating", () => {
  const viaResults = parseRerankScores({ results: [{ id: "fact:a", score: 0.5 }] }, ids);
  assert.equal(viaResults.get("fact:a"), 0.5);
  const viaRanking = parseRerankScores({ ranking: [{ id: "fact:c", rating: 1 }] }, ids);
  assert.equal(viaRanking.get("fact:c"), 1);
});

test("accepts a bare top-level array", () => {
  const m = parseRerankScores([{ id: "fact:a", relevance: 0.3 }], ids);
  assert.equal(m.get("fact:a"), 0.3);
});

test("returns empty map for malformed / non-numeric input", () => {
  assert.equal(parseRerankScores(null, ids).size, 0);
  assert.equal(parseRerankScores({ scores: "nope" }, ids).size, 0);
  assert.equal(parseRerankScores({ scores: [{ id: "fact:a", relevance: "abc" }] }, ids).size, 0);
});
