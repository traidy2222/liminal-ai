import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeHtmlCoherence,
  isLikelyHtmlFile,
  validateHtmlAppendChunk,
} from "./html_write_coherence.js";

test("isLikelyHtmlFile detects .html paths", () => {
  assert.equal(isLikelyHtmlFile("game.html", ""), true);
  assert.equal(isLikelyHtmlFile("x.ts", "export const a = 1"), false);
});

test("analyzeHtmlCoherence flags multiple module scripts", () => {
  const html = `<!DOCTYPE html><html><body>
<script type="module">const a = 1;</script>
<script type="module">console.log(a);</script>
</body></html>`;
  const issues = analyzeHtmlCoherence(html);
  assert.ok(issues.some((i) => i.code === "multiple_module_scripts"));
});

test("validateHtmlAppendChunk rejects second module tag", () => {
  const existing = `<html><body><script type="module">let x = 1;`;
  const payload = `<script type="module">more();</script>`;
  const err = validateHtmlAppendChunk(existing, payload, "game.html");
  assert.ok(err?.includes("another"));
});

test("validateHtmlAppendChunk rejects append after closed document", () => {
  const existing = "<html></html>";
  const err = validateHtmlAppendChunk(existing, "<script>", "game.html");
  assert.ok(err?.includes("already has </html>"));
});

test("validateHtmlAppendChunk allows raw JS append inside open module", () => {
  const existing = `<html><body><script type="module">let x = 1;\n`;
  const payload = "x += 1;\n";
  assert.equal(validateHtmlAppendChunk(existing, payload, "game.html"), null);
});
