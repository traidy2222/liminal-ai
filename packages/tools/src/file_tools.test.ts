import test from "node:test";
import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { resolveWorkspaceRoot } from "@liminal/core";
import { resolveWithinWorkspace } from "./file_path_guard.js";
import { writeFileIfChangedTool } from "./write_file_if_changed.js";
import { multiFileApplyTool } from "./multi_file_apply.js";

test("resolveWithinWorkspace blocks escaping paths", () => {
  const blocked = resolveWithinWorkspace("..\\..\\outside.txt");
  assert.equal(blocked.ok, false);
});

test("write_file_if_changed no-op when content same", async () => {
  const root = resolveWorkspaceRoot();
  const rel = ".agent_artifacts/test-write-if-changed.txt";
  const abs = path.resolve(root, rel);
  await writeFileIfChangedTool.handler({ path: rel, content: "abc" }).then((r) => assert.equal(r.ok, true));
  const second = await writeFileIfChangedTool.handler({ path: rel, content: "abc" });
  assert.equal(second.ok, true);
  if (second.ok) assert.match(second.output, /No change/);
  await rm(abs, { force: true });
});

test("multi_file_apply rollback restores previous content", async () => {
  const root = resolveWorkspaceRoot();
  const rel = ".agent_artifacts/test-multi-file-apply.txt";
  const abs = path.resolve(root, rel);
  await writeFileIfChangedTool.handler({ path: rel, content: "ORIGINAL" });
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

