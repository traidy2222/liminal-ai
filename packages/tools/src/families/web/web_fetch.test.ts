import test from "node:test";
import assert from "node:assert/strict";
import {
  buildWebFetchInit,
  decodeBodyWithCharset,
  parseCharsetFromContentType,
  peekLooksLikeBotWall,
  resolveTextDecoderLabel,
} from "./web_fetch_http.js";
import {
  looksLikeDecodedBinaryGarbage,
  refuseBinaryWebFetchContentType,
  refuseBinaryWebFetchUrl,
  resolveWebFetchReadabilityMaxInputChars,
  resolveWebFetchTotalWallMs,
  resolveWebFetchDefaultMaxChars,
  resolveEffectiveWebFetchMaxChars,
  buildWikipediaExtractApiUrl,
  isJunkDiscoveredLink,
  isWikipediaRestSummaryUrl,
  extractMainContentFallback,
  WEB_FETCH_WIKI_FULL_EXTRACT_MAX,
  sniffCompressedPayloadHead,
} from "./web_fetch.js";

test("parseCharsetFromContentType reads charset parameter", () => {
  assert.equal(parseCharsetFromContentType('text/html; charset="iso-8859-1"'), "iso-8859-1");
  assert.equal(parseCharsetFromContentType("text/html; charset=UTF-8"), "utf-8");
  assert.equal(parseCharsetFromContentType("text/html"), "utf-8");
  assert.equal(parseCharsetFromContentType(null), "utf-8");
});

test("resolveTextDecoderLabel falls back for invalid labels", () => {
  assert.equal(resolveTextDecoderLabel("utf-8"), "utf-8");
  assert.equal(resolveTextDecoderLabel("not-a-real-encoding-xyz"), "utf-8");
});

test("decodeBodyWithCharset decodes Latin-1 byte", () => {
  const bytes = new Uint8Array([0xe9]);
  const text = decodeBodyWithCharset(bytes, "text/html; charset=iso-8859-1");
  assert.equal(text, "\u00e9");
});

test("buildWebFetchInit primary includes Chromium navigation headers", () => {
  const init = buildWebFetchInit("primary");
  const h = init.headers as Record<string, string>;
  assert.match(h["User-Agent"] ?? "", /Chrome\/\d+/i);
  assert.ok((h["Accept"] ?? "").includes("image/avif"));
  assert.ok((h["Accept"] ?? "").includes("signed-exchange"));
  assert.ok((h["Accept-Encoding"] ?? "").includes("br"));
  assert.ok(!(h["Accept-Encoding"] ?? "").includes("zstd"));
  assert.equal(h["Sec-Fetch-Mode"], "navigate");
  assert.equal(h["Sec-Fetch-Dest"], "document");
  assert.equal(h["Sec-Fetch-Site"], "none");
  assert.equal(h["Sec-Fetch-User"], "?1");
  assert.equal(h["Priority"], "u=0, i");
  assert.ok((h["sec-ch-ua"] ?? "").includes("Chromium"));
  assert.ok((h["sec-ch-ua-full-version-list"] ?? "").includes("Google Chrome"));
});

test("buildWebFetchInit chrome_cross_site sets Referer and cross-site fetch metadata", () => {
  const init = buildWebFetchInit("chrome_cross_site");
  const h = init.headers as Record<string, string>;
  assert.match(h["User-Agent"] ?? "", /Chrome\/\d+/i);
  assert.ok(h["Referer"]?.includes("google.com"));
  assert.equal(h["Sec-Fetch-Site"], "cross-site");
  assert.ok((h["sec-ch-ua"] ?? "").length > 0);
});

test("buildWebFetchInit alt sets Referer and cross-site Sec-Fetch-Site", () => {
  const init = buildWebFetchInit("alt");
  const h = init.headers as Record<string, string>;
  assert.match(h["User-Agent"] ?? "", /Firefox|Gecko/i);
  assert.ok(h["Referer"]?.includes("google.com"));
  assert.equal(h["Sec-Fetch-Site"], "cross-site");
  assert.equal(h["Sec-Fetch-User"], "?1");
});

test("buildWebFetchInit primary omits Client Hints when UA is not Chromium-shaped", () => {
  const prev = process.env["AGENT_WEB_FETCH_USER_AGENT"];
  process.env["AGENT_WEB_FETCH_USER_AGENT"] = "curl/8.5.0";
  try {
    const h = buildWebFetchInit("primary").headers as Record<string, string>;
    assert.equal(h["sec-ch-ua"], undefined);
    assert.ok((h["Accept"] ?? "").includes("text/html"));
  } finally {
    if (prev === undefined) delete process.env["AGENT_WEB_FETCH_USER_AGENT"];
    else process.env["AGENT_WEB_FETCH_USER_AGENT"] = prev;
  }
});

test("resolveWebFetchReadabilityMaxInputChars default is bounded", () => {
  const prev = process.env["AGENT_WEB_FETCH_READABILITY_MAX_INPUT_CHARS"];
  delete process.env["AGENT_WEB_FETCH_READABILITY_MAX_INPUT_CHARS"];
  try {
    assert.equal(resolveWebFetchReadabilityMaxInputChars(), 72_000);
  } finally {
    if (prev === undefined) delete process.env["AGENT_WEB_FETCH_READABILITY_MAX_INPUT_CHARS"];
    else process.env["AGENT_WEB_FETCH_READABILITY_MAX_INPUT_CHARS"] = prev;
  }
});

test("resolveWebFetchTotalWallMs default is 55s", () => {
  const prev = process.env["AGENT_WEB_FETCH_TOTAL_WALL_MS"];
  delete process.env["AGENT_WEB_FETCH_TOTAL_WALL_MS"];
  try {
    assert.equal(resolveWebFetchTotalWallMs(), 55_000);
  } finally {
    if (prev === undefined) delete process.env["AGENT_WEB_FETCH_TOTAL_WALL_MS"];
    else process.env["AGENT_WEB_FETCH_TOTAL_WALL_MS"] = prev;
  }
});

test("refuseBinaryWebFetchUrl blocks archives and binaries by path suffix", () => {
  assert.ok(refuseBinaryWebFetchUrl("https://cdn.example/releases/app-1.0.0.zip"));
  assert.ok(refuseBinaryWebFetchUrl("https://x/y.tar.gz"));
  assert.ok(refuseBinaryWebFetchUrl("https://x/setup.exe"));
  assert.equal(refuseBinaryWebFetchUrl("https://example.com/blog/post"), null);
  assert.equal(refuseBinaryWebFetchUrl("https://example.com/doc.pdf"), null);
});

test("refuseBinaryWebFetchContentType blocks gzip and zip main types", () => {
  assert.ok(refuseBinaryWebFetchContentType("application/gzip"));
  assert.ok(refuseBinaryWebFetchContentType("application/zip; charset=binary"));
  assert.equal(refuseBinaryWebFetchContentType("text/html; charset=utf-8"), null);
  assert.equal(refuseBinaryWebFetchContentType("application/pdf"), null);
});

test("sniffCompressedPayloadHead detects gzip and zlib heads", () => {
  assert.ok(sniffCompressedPayloadHead(new Uint8Array([0x1f, 0x8b, 0x08]))?.includes("gzip"));
  assert.ok(sniffCompressedPayloadHead(new Uint8Array([0x78, 0x9c, 0x01]))?.includes("zlib"));
  assert.equal(sniffCompressedPayloadHead(new Uint8Array([0x3c, 0x68])), null);
});

test("looksLikeDecodedBinaryGarbage flags high replacement/control density", () => {
  assert.equal(looksLikeDecodedBinaryGarbage("short"), false);
  const noisy = "\ufffd".repeat(500) + "x".repeat(500);
  assert.equal(looksLikeDecodedBinaryGarbage(noisy), true);
  const htmlish = "<html><body>" + "hello world ".repeat(200) + "</body></html>";
  assert.equal(looksLikeDecodedBinaryGarbage(htmlish), false);
});

test("peekLooksLikeBotWall detects common interstitial markers", () => {
  assert.equal(peekLooksLikeBotWall("<title>Attention Required! | Cloudflare</title>"), true);
  assert.equal(
    peekLooksLikeBotWall(
      '<p id="cmsg">Please enable JS and disable any ad blocker</p><script src="https://ct.captcha-delivery.com/i.js">'
    ),
    true
  );
  assert.equal(peekLooksLikeBotWall("<html><body>Article about cats</body></html>"), false);
});

test("buildWikipediaExtractApiUrl builds MediaWiki query for wiki titles", () => {
  const api = buildWikipediaExtractApiUrl("https://en.wikipedia.org/wiki/Eiffel_Tower");
  assert.ok(api?.includes("en.wikipedia.org/w/api.php"));
  assert.ok(api?.includes("prop=extracts"));
  assert.ok(api?.includes("Eiffel"));
});

test("resolveWebFetchDefaultMaxChars default is 32000", () => {
  const prev = process.env["AGENT_WEB_FETCH_DEFAULT_MAX_CHARS"];
  delete process.env["AGENT_WEB_FETCH_DEFAULT_MAX_CHARS"];
  try {
    assert.equal(resolveWebFetchDefaultMaxChars(), 32_000);
  } finally {
    if (prev === undefined) delete process.env["AGENT_WEB_FETCH_DEFAULT_MAX_CHARS"];
    else process.env["AGENT_WEB_FETCH_DEFAULT_MAX_CHARS"] = prev;
  }
});

test("resolveEffectiveWebFetchMaxChars ignores model caps below harness default", () => {
  const prev = process.env["AGENT_WEB_FETCH_DEFAULT_MAX_CHARS"];
  delete process.env["AGENT_WEB_FETCH_DEFAULT_MAX_CHARS"];
  try {
    assert.equal(resolveEffectiveWebFetchMaxChars(undefined), 32_000);
    assert.equal(resolveEffectiveWebFetchMaxChars(6000), 32_000);
    assert.equal(resolveEffectiveWebFetchMaxChars(50_000), 50_000);
  } finally {
    if (prev === undefined) delete process.env["AGENT_WEB_FETCH_DEFAULT_MAX_CHARS"];
    else process.env["AGENT_WEB_FETCH_DEFAULT_MAX_CHARS"] = prev;
  }
});

test("buildWikipediaExtractApiUrl accepts REST summary URLs", () => {
  const api = buildWikipediaExtractApiUrl(
    "https://en.wikipedia.org/api/rest_v1/page/summary/Eiffel_Tower"
  );
  assert.ok(api?.includes("prop=extracts"));
  assert.ok(api?.includes("Eiffel"));
});

test("isWikipediaRestSummaryUrl detects REST summary paths", () => {
  assert.equal(
    isWikipediaRestSummaryUrl("https://en.wikipedia.org/api/rest_v1/page/summary/Eiffel_Tower"),
    true
  );
  assert.equal(isWikipediaRestSummaryUrl("https://en.wikipedia.org/wiki/Eiffel_Tower"), false);
});

test("WEB_FETCH_WIKI_FULL_EXTRACT_MAX covers typical long Wikipedia articles", () => {
  assert.ok(WEB_FETCH_WIKI_FULL_EXTRACT_MAX >= 44_690);
});

test("isJunkDiscoveredLink filters wikipedia static noise", () => {
  assert.equal(isJunkDiscoveredLink("https://en.wikipedia.org/w/load.php?lang=en"), true);
  assert.equal(isJunkDiscoveredLink("https://en.wikipedia.org/wiki/Paris"), false);
});

test("extractMainContentFallback prefers mw-content-text", () => {
  const html =
    '<div id="mw-content-text"><p>The Eiffel Tower is a lattice tower.</p></div>' +
    '<div class="printfooter">footer</div>' +
    "<nav>Jump to content Main menu</nav>";
  const text = extractMainContentFallback(html);
  assert.match(text, /lattice tower/);
  assert.doesNotMatch(text, /Jump to content/);
});
