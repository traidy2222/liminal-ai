import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTemporalQuery } from "./web_search_ddg.js";
import { mapSerperOrganic, serperErrorMessage } from "./web_search_serper.js";
import { formatWebSearchOutput, runWebSearch } from "./web_search_providers.js";

test("normalizeTemporalQuery anchors latest-intent queries to current year", () => {
  const year = new Date().getFullYear();
  assert.equal(normalizeTemporalQuery("latest react release"), `latest react release ${year}`);
  assert.equal(normalizeTemporalQuery("tokyo"), "tokyo");
});

test("mapSerperOrganic maps organic rows to hits", () => {
  const hits = mapSerperOrganic(
    [
      { title: "Example", link: "https://example.com/page", snippet: "Hello" },
      { title: "Skip", url: "", snippet: "nope" },
      { title: "Two", link: "https://two.test", snippet: "" },
    ],
    5
  );
  assert.equal(hits.length, 2);
  assert.deepEqual(hits[0], {
    url: "https://example.com/page",
    title: "Example",
    snippet: "Hello",
  });
});

test("serperErrorMessage maps auth and quota codes", () => {
  assert.match(serperErrorMessage(401, null), /api key/i);
  assert.match(serperErrorMessage(429, null), /rate limit/i);
  assert.equal(serperErrorMessage(500, { message: "boom" }), "boom");
});

test("runWebSearch uses duckduckgo when provider is duckduckgo", async () => {
  const html = `
    <a class="result__a" href="https://docs.example.com">Docs</a>
    <div class="result__snippet">Official docs</div>
  `;
  const fetchImpl = async () =>
    new Response(html, { status: 200, headers: { "Content-Type": "text/html" } });

  const result = await runWebSearch("example docs", 3, {
    provider: "duckduckgo",
    fetchFn: fetchImpl as typeof fetch,
  });
  assert.equal(result.provider, "duckduckgo");
  assert.equal(result.hits.length, 1);
  assert.equal(result.hits[0]!.url, "https://docs.example.com");
});

test("runWebSearch serper success returns serper provider", async () => {
  const fetchImpl = async (url: string | URL | Request) => {
    const u = String(url);
    assert.ok(u.includes("serper.dev"));
    return new Response(
      JSON.stringify({
        organic: [{ title: "A", link: "https://a.test", snippet: "sa" }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  const result = await runWebSearch("query", 5, {
    provider: "serper",
    serperApiKey: "test-key",
    fetchFn: fetchImpl as typeof fetch,
  });
  assert.equal(result.provider, "serper");
  assert.equal(result.hits[0]!.url, "https://a.test");
});

test("runWebSearch falls back to duckduckgo when serper fails", async () => {
  const ddgHtml = `
    <a class="result__a" href="https://fallback.example">Fallback</a>
    <div class="result__snippet">via ddg</div>
  `;
  let calls = 0;
  const fetchImpl = async (url: string | URL | Request) => {
    calls += 1;
    const u = String(url);
    if (u.includes("serper.dev")) {
      return new Response(JSON.stringify({ message: "bad key" }), { status: 401 });
    }
    return new Response(ddgHtml, { status: 200, headers: { "Content-Type": "text/html" } });
  };

  const result = await runWebSearch("fallback test", 3, {
    provider: "serper",
    serperApiKey: "bad",
    fetchFn: fetchImpl as typeof fetch,
  });
  assert.ok(calls >= 2);
  assert.equal(result.fallbackFrom, "serper");
  assert.equal(result.provider, "duckduckgo");
  assert.equal(result.hits[0]!.url, "https://fallback.example");
  const out = formatWebSearchOutput(result);
  assert.match(out, /fell back to DuckDuckGo/i);
});
