import test from "node:test";
import assert from "node:assert/strict";
import { emptyEpistemicState, mergeEpistemicState, renderEpistemicStateBlock } from "./epistemic_state.js";

test("mergeEpistemicState merges files and budget", () => {
  const a = emptyEpistemicState("do thing");
  const b = mergeEpistemicState(a, {
    filesTouched: ["src/a.ts"],
    budget: { usagePct: 44, recallK: 6, spareRounds: 9 },
    harnessNotes: "batch ok",
  });
  assert.equal(b.filesTouched.includes("src/a.ts"), true);
  assert.equal(b.budget.usagePct, 44);
  assert.ok(renderEpistemicStateBlock(b).includes("batch ok"));
});
