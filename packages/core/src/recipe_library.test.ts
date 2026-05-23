import test from "node:test";
import assert from "node:assert/strict";
import { phaseShapeForTools } from "./recipe_library.js";

test("phaseShapeForTools dedupes consecutive phases", () => {
  assert.deepEqual(
    phaseShapeForTools(["read_file", "grep_file", "write_file", "run_tests"]),
    ["LOCATE", "MUTATE", "VERIFY"]
  );
});

test("phaseShapeForTools builds stable recipe key shape", () => {
  const shape = phaseShapeForTools(["read_file", "write_file", "run_tests"]);
  const key = `coding::${shape.join("→")}`;
  assert.match(key, /^coding::LOCATE→MUTATE→VERIFY$/);
});
