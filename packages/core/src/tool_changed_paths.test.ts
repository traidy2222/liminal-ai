import test from "node:test";
import assert from "node:assert/strict";
import { collectEditToolTargetPaths } from "./tool_changed_paths.js";

test("collectEditToolTargetPaths parses edit_file path", () => {
  const paths = collectEditToolTargetPaths("edit_file", {
    path: "src/foo.ts",
    replacements: [{ search: "a", replace: "b" }],
  });
  assert.deepEqual(paths, ["src/foo.ts"]);
});

test("collectEditToolTargetPaths multi_file_apply respects dry_run", () => {
  const paths = collectEditToolTargetPaths("multi_file_apply", {
    dry_run: true,
    operations: [{ op: "write", path: "x.ts", content: "1" }],
  });
  assert.deepEqual(paths, []);
});

test("collectEditToolTargetPaths multi_file_apply collects write and move paths", () => {
  const paths = collectEditToolTargetPaths("multi_file_apply", {
    operations: [
      { op: "write", path: "a.ts", content: "x" },
      { op: "move", from: "old.txt", to: "new.txt" },
    ],
  });
  assert.ok(paths.includes("a.ts"));
  assert.ok(paths.includes("old.txt"));
  assert.ok(paths.includes("new.txt"));
});
