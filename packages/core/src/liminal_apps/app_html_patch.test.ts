import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyHtmlEdit,
  applyTextReplacements,
  grepAppHtmlLines,
  readAppHtmlSlice,
} from "./app_html_patch.js";

test("applyTextReplacements patches widget html", () => {
  const src = "<div id='app'>OLD</div>";
  const { content, changed } = applyTextReplacements(src, [{ search: "OLD", replace: "NEW" }]);
  assert.equal(changed, true);
  assert.match(content, /NEW/);
});

test("grepAppHtmlLines finds pattern with line numbers", () => {
  const out = grepAppHtmlLines("<a>\n<b>target</b>\n</a>", "target");
  assert.match(out, /line 2/);
  assert.match(out, /target/);
});

test("readAppHtmlSlice returns numbered excerpt", () => {
  const out = readAppHtmlSlice("line1\nline2\nline3", { startLine: 2, endLine: 2 });
  assert.match(out, /2\| line2/);
});

test("applyHtmlEdit rejects both modes", () => {
  const r = applyHtmlEdit("x", { replacements: [{ search: "x", replace: "y" }], diff: "@@" });
  assert.equal(r.changed, false);
  assert.match(r.report[0]!, /one of/);
});
