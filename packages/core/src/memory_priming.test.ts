import test from "node:test";
import assert from "node:assert/strict";
import { rankNotesForPriming } from "./memory_priming.js";

test("rankNotesForPriming returns empty for short query", async () => {
  const lines = await rankNotesForPriming({ query: "x" });
  assert.deepEqual(lines, []);
});
