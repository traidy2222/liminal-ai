import assert from "node:assert/strict";
import test from "node:test";
import { extractComposeDockWirePreview } from "./compose_dock_preview.js";

test("extractComposeDockWirePreview streams partial write_file content", () => {
  const partial = '{"path":"src/a.ts","content":"export const x = 1;';
  const preview = extractComposeDockWirePreview("write_file", partial);
  assert.ok(preview);
  assert.equal(preview!.kind, "file");
  assert.equal(preview!.path, "src/a.ts");
  assert.match(preview!.content, /export const x/);
  assert.equal(preview!.incomplete, true);
});

test("extractComposeDockWirePreview streams partial edit_file replace", () => {
  const partial =
    '{"path":"b.ts","replacements":[{"search":"old","replace":"new val';
  const preview = extractComposeDockWirePreview("edit_file", partial);
  assert.ok(preview);
  assert.match(preview!.content, /new val/);
  assert.equal(preview!.incomplete, true);
});
