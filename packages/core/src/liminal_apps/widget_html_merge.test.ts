import assert from "node:assert/strict";
import { test } from "node:test";
import { repairWidgetHtmlDocument } from "./widget_html_merge.js";

test("repairWidgetHtmlDocument moves trailing chunks inside body", () => {
  const broken =
    '<!DOCTYPE html><html><body><div id="app"></div></body></html><style>body{color:red}</style><script>document.getElementById("app").textContent="ok";</script>';
  const fixed = repairWidgetHtmlDocument(broken);
  assert.match(fixed, /<style>body\{color:red\}<\/style><script>/);
  assert.match(fixed, /<\/script><\/body><\/html>$/);
  assert.equal(fixed.toLowerCase().indexOf("</html>"), fixed.toLowerCase().lastIndexOf("</html>"));
});
