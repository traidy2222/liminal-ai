import test from "node:test";
import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { resolveWorkspaceRoot } from "@liminal/core";
import { resolveWithinWorkspace } from "./file_path_guard.js";
import { multiFileApplyTool } from "./multi_file_apply.js";
import { writeFileTool } from "./write_file.js";
import { isLikelyTruncatedContent } from "./file_write_integrity.js";
import { rejectIfLikelyTruncated, TRUNCATED_WRITE_ERROR } from "./file_write_ops.js";

test("resolveWithinWorkspace blocks escaping paths", () => {
  const blocked = resolveWithinWorkspace("..\\..\\outside.txt");
  assert.equal(blocked.ok, false);
});

test("write_file mode=overwrite replaces existing content", async () => {
  const root = resolveWorkspaceRoot();
  const rel = ".agent_artifacts/test-write-overwrite.txt";
  const abs = path.resolve(root, rel);
  await rm(abs, { force: true });
  const created = await writeFileTool.handler({ path: rel, content: "v1" });
  assert.equal(created.ok, true);
  const overwritten = await writeFileTool.handler({ path: rel, content: "v2", mode: "overwrite" });
  assert.equal(overwritten.ok, true);
  assert.equal(await readFile(abs, "utf8"), "v2");
  await rm(abs, { force: true });
});

test("write_file mode=create refuses an existing file", async () => {
  const root = resolveWorkspaceRoot();
  const rel = ".agent_artifacts/test-write-create-guard.txt";
  const abs = path.resolve(root, rel);
  await rm(abs, { force: true });
  assert.equal((await writeFileTool.handler({ path: rel, content: "x" })).ok, true);
  const second = await writeFileTool.handler({ path: rel, content: "y" });
  assert.equal(second.ok, false);
  await rm(abs, { force: true });
});

test("multi_file_apply rollback restores previous content", async () => {
  const root = resolveWorkspaceRoot();
  const rel = ".agent_artifacts/test-multi-file-apply.txt";
  const abs = path.resolve(root, rel);
  await rm(abs, { force: true });
  await writeFileTool.handler({ path: rel, content: "ORIGINAL" });
  const result = await multiFileApplyTool.handler({
    operations: [
      { op: "write", path: rel, content: "NEXT" },
      { op: "move", from: "..\\escape.txt", to: rel },
    ],
  });
  assert.equal(result.ok, false);
  const after = await readFile(abs, "utf8");
  assert.equal(after, "ORIGINAL");
  await rm(abs, { force: true });
});

test("isLikelyTruncatedContent flags unclosed brace", () => {
  assert.equal(isLikelyTruncatedContent("function f() {"), true);
});

test("write_file accepts JSDoc with apostrophes and backticks", async () => {
  const root = resolveWorkspaceRoot();
  const rel = ".agent_artifacts/test-jsdoc-apostrophe.ts";
  const abs = path.resolve(root, rel);
  await rm(abs, { force: true });
  const content = `/**
 * Creates a debounced version of \`fn\` — the function's return value.
 */
export const ok = 1;
`;
  assert.equal(isLikelyTruncatedContent(content), false);
  const r = await writeFileTool.handler({ path: rel, content });
  assert.equal(r.ok, true);
  assert.equal(await readFile(abs, "utf8"), content);
  await rm(abs, { force: true });
});

test("write_file rejects likely truncated content", async () => {
  const root = resolveWorkspaceRoot();
  const rel = ".agent_artifacts/test-trunc-reject.txt";
  const abs = path.resolve(root, rel);
  await rm(abs, { force: true });
  const r = await writeFileTool.handler({ path: rel, content: 'const x = "' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error, TRUNCATED_WRITE_ERROR);
  await rm(abs, { force: true });
});

test("rejectIfLikelyTruncated matches integrity heuristic", () => {
  assert.ok(rejectIfLikelyTruncated("export function f() {"));
});

test("write_file mode=create then mode=append builds full file", async () => {
  const root = resolveWorkspaceRoot();
  const rel = ".agent_artifacts/test-append-chain.txt";
  const abs = path.resolve(root, rel);
  await rm(abs, { force: true });
  const w = await writeFileTool.handler({ path: rel, content: "line1\n" });
  assert.equal(w.ok, true);
  const a = await writeFileTool.handler({ path: rel, content: "line2\n", mode: "append" });
  assert.equal(a.ok, true);
  const full = await readFile(abs, "utf8");
  assert.equal(full, "line1\nline2\n");
  await rm(abs, { force: true });
});

test("write_file mode=append creates the file when missing", async () => {
  const root = resolveWorkspaceRoot();
  const rel = ".agent_artifacts/test-append-create.txt";
  const abs = path.resolve(root, rel);
  await rm(abs, { force: true });
  const a = await writeFileTool.handler({ path: rel, content: "fresh", mode: "append" });
  assert.equal(a.ok, true);
  assert.equal(await readFile(abs, "utf8"), "fresh");
  await rm(abs, { force: true });
});
