import test from "node:test";
import assert from "node:assert/strict";
import {
  isSerperWebFetchEnabled,
  runSerperWebFetch,
  shouldAttemptSerperWebFetch,
} from "./web_fetch_serper.js";

test("isSerperWebFetchEnabled requires key and respects AGENT_WEB_FETCH_SERPER=0", () => {
  const prevKey = process.env["AGENT_SERPER_API_KEY"];
  const prevFlag = process.env["AGENT_WEB_FETCH_SERPER"];
  try {
    delete process.env["AGENT_SERPER_API_KEY"];
    delete process.env["AGENT_WEB_FETCH_SERPER"];
    assert.equal(isSerperWebFetchEnabled(), false);

    process.env["AGENT_SERPER_API_KEY"] = "k";
    assert.equal(isSerperWebFetchEnabled(), true);

    process.env["AGENT_WEB_FETCH_SERPER"] = "0";
    assert.equal(isSerperWebFetchEnabled(), false);
  } finally {
    if (prevKey === undefined) delete process.env["AGENT_SERPER_API_KEY"];
    else process.env["AGENT_SERPER_API_KEY"] = prevKey;
    if (prevFlag === undefined) delete process.env["AGENT_WEB_FETCH_SERPER"];
    else process.env["AGENT_WEB_FETCH_SERPER"] = prevFlag;
  }
});

test("shouldAttemptSerperWebFetch skips assets and binary suffixes", () => {
  const prevKey = process.env["AGENT_SERPER_API_KEY"];
  const prevFlag = process.env["AGENT_WEB_FETCH_SERPER"];
  try {
    process.env["AGENT_SERPER_API_KEY"] = "k";
    process.env["AGENT_WEB_FETCH_SERPER"] = "1";
    assert.equal(shouldAttemptSerperWebFetch("https://example.com/article"), true);
    assert.equal(shouldAttemptSerperWebFetch("https://example.com/a.pdf"), false);
    assert.equal(
      shouldAttemptSerperWebFetch("https://example.com/article", { includeAssets: true }),
      false
    );
  } finally {
    if (prevKey === undefined) delete process.env["AGENT_SERPER_API_KEY"];
    else process.env["AGENT_SERPER_API_KEY"] = prevKey;
    if (prevFlag === undefined) delete process.env["AGENT_WEB_FETCH_SERPER"];
    else process.env["AGENT_WEB_FETCH_SERPER"] = prevFlag;
  }
});

test("runSerperWebFetch maps markdown and paginates", async () => {
  const body = "# Hello\n\n".padEnd(120, "x");
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(url), "https://scrape.serper.dev");
    const payload = JSON.parse(String(init?.body));
    assert.equal(payload.url, "https://docs.example.com/page");
    assert.equal(payload.includeMarkdown, true);
    return new Response(
      JSON.stringify({
        markdown: body,
        metadata: { title: "Docs" },
        credits: 2,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  const result = await runSerperWebFetch("https://docs.example.com/page", 50, {
    apiKey: "test-key",
    fetchImpl: fetchImpl as typeof fetch,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.output, /\[Fetched via Serper scrape\]/);
  assert.match(result.output, /Title: Docs/);
  assert.match(result.output, /Serper credits: 2/);
  assert.ok(result.output.length <= 50 + 200);
});

test("runSerperWebFetch returns retryable error on quota", async () => {
  const fetchImpl = async () =>
    new Response(JSON.stringify({ message: "quota" }), { status: 402 });

  const result = await runSerperWebFetch("https://example.com", 1000, {
    apiKey: "test-key",
    fetchImpl: fetchImpl as typeof fetch,
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error, /quota/i);
  assert.equal(result.retryable, true);
});
