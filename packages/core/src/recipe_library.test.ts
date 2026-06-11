import test from "node:test";
import assert from "node:assert/strict";
import {
  compactToolSequenceForPrime,
  formatRecipePrimeMessage,
  phaseShapeForTools,
  type RecipeEntry,
} from "./recipe_library.js";

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

test("compactToolSequenceForPrime collapses repeated tools", () => {
  assert.equal(
    compactToolSequenceForPrime("grep_file → grep_file → grep_file → edit_file"),
    "grep_file ×3 → edit_file"
  );
});

test("formatRecipePrimeMessage is a one-line positive hint", () => {
  const entry: RecipeEntry = {
    key: "coding::LOCATE→MUTATE",
    intentClass: "coding",
    phaseShape: ["LOCATE", "MUTATE"],
    count: 4,
    outcomeSum: 2.8,
    outcomeCount: 4,
    toolUnion: ["grep_file", "edit_file"],
    bestExample: {
      toolSequence: "grep_file → grep_file → edit_file",
      outcome: 0.75,
      at: "2026-01-01T00:00:00.000Z",
    },
    firstAt: "2026-01-01T00:00:00.000Z",
    lastAt: "2026-01-02T00:00:00.000Z",
  };
  const msg = formatRecipePrimeMessage(entry);
  assert.match(msg, /^\[RECIPE PRIME\] Similar past turns succeeded with:/);
  assert.match(msg, /grep_file ×2 → edit_file/);
  assert.match(msg, /reused ×4/);
});
