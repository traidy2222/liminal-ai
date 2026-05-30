import test from "node:test";
import assert from "node:assert/strict";
import {
  isHtmlEmbedLang,
  extractFencedCodeText,
  balanceHtmlForStreamingPreview,
  extractStreamingHtmlFence,
} from "./liminalMarkdownUtils.js";

test("isHtmlEmbedLang recognizes html embed languages", () => {
  assert.equal(isHtmlEmbedLang("html"), true);
  assert.equal(isHtmlEmbedLang("HTML"), true);
  assert.equal(isHtmlEmbedLang("htm"), true);
  assert.equal(isHtmlEmbedLang("xhtml"), true);
  assert.equal(isHtmlEmbedLang("javascript"), false);
  assert.equal(isHtmlEmbedLang(undefined), false);
});

test("extractFencedCodeText strips trailing newline", () => {
  assert.equal(extractFencedCodeText("<div></div>\n"), "<div></div>");
});

test("balanceHtmlForStreamingPreview drops incomplete tail tag and closes open elements", () => {
  const partial = '<div style="color:red"><p>Hello<strong>world';
  const balanced = balanceHtmlForStreamingPreview(partial);
  assert.match(balanced, /<div/);
  assert.match(balanced, /Hello/);
  assert.match(balanced, /<\/strong><\/p><\/div>$/);
});

test("balanceHtmlForStreamingPreview strips truncated open tag at end", () => {
  const partial = "<div><span>ok</span><div style=\"background";
  const balanced = balanceHtmlForStreamingPreview(partial);
  assert.doesNotMatch(balanced, /style="background/);
  assert.match(balanced, /<\/div>$/);
});

test("extractStreamingHtmlFence peels open html fence for live render", () => {
  const open = "Intro\n\n```html\n<div>partial";
  const split = extractStreamingHtmlFence(open);
  assert.equal(split.outerMarkdown, "Intro");
  assert.equal(split.htmlLive, "<div>partial");
});

test("extractStreamingHtmlFence returns full text when fence is closed", () => {
  const closed = "```html\n<div>ok</div>\n```\nDone";
  const split = extractStreamingHtmlFence(closed);
  assert.equal(split.outerMarkdown, closed);
  assert.equal(split.htmlLive, null);
});

test("extractStreamingHtmlFence ignores non-html fences", () => {
  const js = "```javascript\nconst x = 1";
  const split = extractStreamingHtmlFence(js);
  assert.equal(split.outerMarkdown, js);
  assert.equal(split.htmlLive, null);
});
