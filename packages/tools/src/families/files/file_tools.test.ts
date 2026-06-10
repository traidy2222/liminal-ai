import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveWorkspaceRoot, runWithWorkspaceRoot } from "@liminal/core";
import { resolveWithinWorkspace } from "../../shared/file_path_guard.js";
import { readFileTool } from "./read_file.js";
import { readFileChunkedTool } from "../navigation/read_file_chunked.js";
import { multiFileApplyTool } from "./multi_file_apply.js";
import { writeFileTool } from "./write_file.js";
import { isLikelyTruncatedContent } from "./file_write_integrity.js";
import { rejectIfLikelyTruncated, TRUNCATED_WRITE_ERROR } from "./file_write_ops.js";

test("resolveWithinWorkspace blocks escaping paths", () => {
  const blocked = resolveWithinWorkspace("..\\..\\outside.txt");
  assert.equal(blocked.ok, false);
});

test("read_file resolves paths against workspace root, not process.cwd()", async () => {
  const ws = await fsMkdtemp();
  const rel = "nested/read-me.txt";
  const abs = path.join(ws, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, "line1\nline2\nline3\n", "utf8");
  const prevCwd = process.cwd();
  try {
    process.chdir(os.tmpdir());
    await runWithWorkspaceRoot(ws, async () => {
      const r = await readFileTool.handler({ path: rel, offset: 2, limit: 1 });
      assert.equal(r.ok, true);
      if (r.ok) assert.match(r.output ?? "", /^line2/);
    });
  } finally {
    process.chdir(prevCwd);
    await rm(ws, { recursive: true, force: true });
  }
});

test("read_file_chunked offset mode reads by line number not chunk index", async () => {
  const ws = await fsMkdtemp();
  const rel = "big.txt";
  const lines = Array.from({ length: 50 }, (_, i) => `L${i + 1}`).join("\n");
  await writeFile(path.join(ws, rel), lines, "utf8");
  try {
    await runWithWorkspaceRoot(ws, async () => {
      const r = await readFileChunkedTool.handler({ path: rel, offset: 10, limit: 3 });
      assert.equal(r.ok, true);
      if (r.ok) {
        assert.match(r.output, /"line_start":\s*10/);
        assert.match(r.output, /L10\nL11\nL12/);
      }
    });
  } finally {
    await rm(ws, { recursive: true, force: true });
  }
});

async function fsMkdtemp(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "liminal-file-tools-"));
}

test("write_file mode=overwrite replaces small existing content", async () => {
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

test("write_file mode=overwrite refuses substantial file without confirm", async () => {
  const root = resolveWorkspaceRoot();
  const rel = ".agent_artifacts/test-write-overwrite-guard.txt";
  const abs = path.resolve(root, rel);
  await rm(abs, { force: true });
  const lines = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join("\n");
  assert.equal((await writeFileTool.handler({ path: rel, content: lines })).ok, true);
  const blocked = await writeFileTool.handler({ path: rel, content: "replaced", mode: "overwrite" });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.match(blocked.error, /edit_file/);
  const allowed = await writeFileTool.handler({
    path: rel,
    content: "replaced",
    mode: "overwrite",
    confirm_overwrite: true,
  });
  assert.equal(allowed.ok, true);
  assert.equal(await readFile(abs, "utf8"), "replaced");
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

test("promoteStagingFile mode=create refuses existing file", async () => {
  const root = resolveWorkspaceRoot();
  const rel = ".agent_artifacts/test-stream-create-guard.txt";
  const abs = path.resolve(root, rel);
  const staging = path.resolve(root, ".agent_artifacts/test-stream-create-guard.staging");
  await rm(abs, { force: true });
  await rm(staging, { force: true });
  const { writeFile: wf } = await import("node:fs/promises");
  await wf(abs, "existing", "utf8");
  await wf(staging, "staged body", "utf8");
  const { promoteStagingFile } = await import("./file_write_ops.js");
  await assert.rejects(
    () => promoteStagingFile(staging, abs, "create"),
    /already exists/
  );
  assert.equal(await readFile(abs, "utf8"), "existing");
  await rm(abs, { force: true });
  await rm(staging, { force: true });
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
