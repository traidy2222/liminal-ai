import test from "node:test";
import assert from "node:assert/strict";
import {
  extractPartialJsonStringField,
  extractPartialProfilePreview,
  extractPartialSoulBatch,
  unescapePartialJsonString,
} from "./persona_stream_extract.js";

test("unescapePartialJsonString handles escapes", () => {
  assert.equal(unescapePartialJsonString("line1\\nline2"), "line1\nline2");
});

test("extractPartialJsonStringField reads incomplete string", () => {
  const buf = '{"identityMd": "# Identity Core\\n\\nStill writing';
  const v = extractPartialJsonStringField(buf, "identityMd");
  assert.ok(v?.includes("Identity Core"));
});

test("extractPartialSoulBatch returns started slices only", () => {
  const buf =
    '{"identityMd": "# Identity Core\\n\\nDone.", "voiceMd": "# Voice DNA\\n\\nPartial';
  const p = extractPartialSoulBatch(buf);
  assert.ok(p.identityMd?.includes("Identity"));
  assert.ok(p.voiceMd?.includes("Voice"));
  assert.equal(p.stanceMd, undefined);
});

test("extractPartialProfilePreview shows name when available", () => {
  const buf = '{"name": "Ada Noir", "coreIdentity": "A terse analyst';
  const preview = extractPartialProfilePreview(buf);
  assert.match(preview, /Ada Noir/);
});
