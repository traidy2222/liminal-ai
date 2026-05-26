import test from "node:test";
import assert from "node:assert/strict";
import {
  ResearchLedger,
  canonicalUrl,
  unwrapSearchRedirect,
  extractUrls,
} from "./research_ledger.js";

// ─── canonicalUrl / unwrapSearchRedirect ─────────────────────────────────────

test("unwrapSearchRedirect extracts the real URL from a DuckDuckGo wrapper", () => {
  const wrapped =
    "https://duckduckgo.com/l/?uddg=https%3A%2F%2Farxiv.org%2Fabs%2F2506.00054&rut=47d6e61b";
  assert.equal(unwrapSearchRedirect(wrapped), "https://arxiv.org/abs/2506.00054");
});

test("unwrapSearchRedirect handles Google /url redirects", () => {
  const wrapped = "https://www.google.com/url?q=https://example.com/article&sa=U";
  assert.equal(unwrapSearchRedirect(wrapped), "https://example.com/article");
});

test("unwrapSearchRedirect returns the input unchanged for direct URLs", () => {
  assert.equal(
    unwrapSearchRedirect("https://arxiv.org/abs/2506.00054"),
    "https://arxiv.org/abs/2506.00054"
  );
});

test("canonicalUrl strips tracking params, fragment, trailing slash", () => {
  const c = canonicalUrl(
    "https://Example.COM/Article/?utm_source=twitter&id=42&fbclid=abc#section"
  );
  assert.equal(c, "https://example.com/Article?id=42");
});

test("canonicalUrl unwraps DDG redirect", () => {
  const c = canonicalUrl(
    "https://duckduckgo.com/l/?uddg=https%3A%2F%2FArxiv.ORG%2Fabs%2F2603.18897%2F&rut=xyz"
  );
  assert.equal(c, "https://arxiv.org/abs/2603.18897");
});

test("canonicalUrl keeps useful query params", () => {
  const c = canonicalUrl("https://example.com/search?q=foo&page=2&utm_medium=ad");
  assert.equal(c, "https://example.com/search?q=foo&page=2");
});

// ─── extractUrls ──────────────────────────────────────────────────────────────

test("extractUrls pulls URLs and strips trailing punctuation", () => {
  const body =
    "See https://example.com/a, also https://example.com/b. End: https://example.com/c).";
  const urls = extractUrls(body);
  assert.deepEqual(urls.sort(), [
    "https://example.com/a",
    "https://example.com/b",
    "https://example.com/c",
  ]);
});

// ─── ResearchLedger end-to-end ───────────────────────────────────────────────

test("ledger records search + URLs and dedups via canonicalization", () => {
  const ledger = new ResearchLedger();
  const body = `
1. SoK: Agentic RAG — Taxonomy
   https://duckduckgo.com/l/?uddg=https%3A%2F%2Farxiv.org%2Fabs%2F2603.07379&rut=a
2. A-RAG: Scaling Agentic RAG
   https://duckduckgo.com/l/?uddg=https%3A%2F%2Farxiv.org%2Fabs%2F2602.03442&rut=b
`;
  ledger.recordSearch("agentic RAG 2026", body, true);
  const s = ledger.summary();
  assert.equal(s.searchCount, 1);
  assert.equal(s.urlInventoryCount, 2);
  assert.equal(s.pending, 2);
  assert.equal(s.fetchedOk, 0);
});

test("ledger dedupes URLs across two different DDG-wrapped searches", () => {
  const ledger = new ResearchLedger();
  ledger.recordSearch(
    "agentic RAG taxonomy",
    "https://duckduckgo.com/l/?uddg=https%3A%2F%2Farxiv.org%2Fabs%2F2603.07379&rut=a",
    true
  );
  // Second search surfaces the same arxiv paper, wrapped differently.
  ledger.recordSearch(
    "SoK RAG sequential decision",
    "https://duckduckgo.com/l/?uddg=https%3A%2F%2Farxiv.org%2Fabs%2F2603.07379&rut=DIFFERENT",
    true
  );
  const s = ledger.summary();
  assert.equal(s.searchCount, 2);
  assert.equal(s.urlInventoryCount, 1, "must dedup to one canonical URL");
});

test("ledger recordFetch flips status pending → fetched_ok", () => {
  const ledger = new ResearchLedger();
  ledger.recordSearch("x", "https://arxiv.org/abs/2603.07379", true);
  assert.equal(ledger.getPendingUrls().length, 1);
  ledger.recordFetch("https://arxiv.org/abs/2603.07379", true, "lorem ipsum dolor sit amet");
  const s = ledger.summary();
  assert.equal(s.pending, 0);
  assert.equal(s.fetchedOk, 1);
  const u = ledger.getUrls({ status: "fetched_ok" })[0]!;
  assert.equal(u.fetchedWordCount, 5);
});

test("ledger records direct web_fetch with no prior search", () => {
  const ledger = new ResearchLedger();
  ledger.recordFetch("https://example.com/page", true, "one two three");
  const s = ledger.summary();
  assert.equal(s.searchCount, 0);
  assert.equal(s.urlInventoryCount, 1);
  assert.equal(s.fetchedOk, 1);
});

test("ledger records failed fetches with the error message", () => {
  const ledger = new ResearchLedger();
  ledger.recordFetch("https://broken.example/x", false, undefined, "HTTP 500");
  const failed = ledger.getUrls({ status: "fetched_fail" });
  assert.equal(failed.length, 1);
  assert.equal(failed[0]!.fetchError, "HTTP 500");
});

test("ledger version bumps on every recording, enabling change detection", () => {
  const ledger = new ResearchLedger();
  const v0 = ledger.getVersion();
  ledger.recordSearch("q", "https://example.com/a", true);
  const v1 = ledger.getVersion();
  assert.ok(v1 > v0);
  ledger.recordFetch("https://example.com/a", true, "body");
  const v2 = ledger.getVersion();
  assert.ok(v2 > v1);
});

test("formatContextBlock returns empty string for empty ledger", () => {
  const ledger = new ResearchLedger();
  assert.equal(ledger.formatContextBlock(), "");
});

test("formatContextBlock reports counts, queries, pending, fetched", () => {
  const ledger = new ResearchLedger();
  ledger.recordSearch(
    "agentic RAG 2026",
    "1. arxiv\n   https://arxiv.org/abs/2603.07379\n2. nature\n   https://nature.com/articles/x",
    true
  );
  ledger.recordFetch("https://arxiv.org/abs/2603.07379", true, "lorem ipsum dolor sit");
  ledger.recordFetch("https://nature.com/articles/x", false, undefined, "403 Forbidden");
  const block = ledger.formatContextBlock();
  assert.match(block, /\[RESEARCH STATE\]/);
  assert.match(block, /searches=1/);
  assert.match(block, /fetched_ok=1/);
  assert.match(block, /fetched_fail=1/);
  assert.match(block, /agentic RAG 2026/);
  assert.match(block, /403 Forbidden/);
});

test("clear resets everything", () => {
  const ledger = new ResearchLedger();
  ledger.recordSearch("x", "https://example.com/a", true);
  ledger.recordFetch("https://example.com/a", true, "body");
  ledger.clear();
  assert.equal(ledger.isEmpty(), true);
  assert.equal(ledger.getVersion(), 0);
  assert.equal(ledger.summary().searchCount, 0);
});
