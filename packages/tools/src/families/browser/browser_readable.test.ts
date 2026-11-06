import test from "node:test";
import assert from "node:assert/strict";
import { buildPageSnapshot } from "../../../dist/families/browser/browser_runtime.js";

test("page observations return readable rendered content without a second fetch", { skip: process.env.AGENT_BROWSER_INTEGRATION !== "1" }, async () => {
  const {chromium} = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const filler = "A paragraph of useful article context. ".repeat(65);
    await page.setContent(`<nav>Navigation menu</nav><main><article style="display:none">HIDDEN_ARTICLE</article><article><h1>Reading fixture</h1><p>${filler}</p><p>ARTICLE_DETAIL_BEYOND_PREVIEW</p><p hidden>HIDDEN_DETAIL</p><a href="https://example.com/source">Source</a></article></main>`);
    const { snapshotText } = await buildPageSnapshot(page);
    assert.match(snapshotText, /READABLE_CONTENT:\nmain:\nReading fixture/);
    assert.match(snapshotText, /ARTICLE_DETAIL_BEYOND_PREVIEW/);
    assert.doesNotMatch(snapshotText, /HIDDEN_ARTICLE|HIDDEN_DETAIL/);
    assert.match(snapshotText, /SNAPSHOT_REFS/); assert.match(snapshotText, /link "Source"/);
    assert.ok(snapshotText.length < 10_200, "observation remains bounded");
  } finally { await browser.close(); }
});
