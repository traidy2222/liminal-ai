import test from "node:test";
import assert from "node:assert/strict";
import {
  dedupeQueries,
  sanitizeEvidenceTuple,
  scoreSourceDomain,
  validateEvidenceTuples,
} from "./web_research.js";

test("dedupeQueries normalizes and caps query count", () => {
  const out = dedupeQueries(
    ["  Same Query  ", "same   query", "second query", "third query"],
    40,
    2
  );
  assert.deepEqual(out, ["Same Query", "second query"]);
});

test("sanitizeEvidenceTuple rejects weak tuples", () => {
  const bad = sanitizeEvidenceTuple(
    {
      claim: "short",
      evidence_quote: "too short",
      source_url: "https://example.com",
      confidence: "med",
      is_time_sensitive: false,
    },
    "https://fallback.example",
    180
  );
  assert.equal(bad, null);
});

test("validateEvidenceTuples dedupes by claim and source", () => {
  const tuples = validateEvidenceTuples(
    [
      {
        claim: "A claim about policy and impact.",
        evidence_quote: "Long enough quote to pass deterministic validation.",
        source_url: "https://a.example/doc",
        confidence: "med",
        is_time_sensitive: false,
      },
      {
        claim: "A claim about policy and impact.",
        evidence_quote: "Another quote for same claim and source.",
        source_url: "https://a.example/doc",
        confidence: "high",
        is_time_sensitive: true,
      },
    ],
    10
  );
  assert.equal(tuples.length, 1);
});

test("scoreSourceDomain tier smoke checks", () => {
  assert.equal(scoreSourceDomain("https://www.reuters.com/world"), 1);
  assert.equal(scoreSourceDomain("https://www.github.com/owner/repo"), 2);
  assert.equal(scoreSourceDomain("https://en.wikipedia.org/wiki/Foo"), 3);
  assert.equal(scoreSourceDomain("https://x.com/somepost"), 4);
});

