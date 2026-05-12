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

test("mergeEpistemicState unions filesModified and render shows both file sections", () => {
  const a = emptyEpistemicState("fix bug");
  const b = mergeEpistemicState(a, { filesModified: ["src/x.ts"] });
  const c = mergeEpistemicState(b, { filesModified: ["src/y.ts", "src/x.ts"] });
  assert.deepEqual(c.filesModified.sort(), ["src/x.ts", "src/y.ts"]);
  const block = renderEpistemicStateBlock(c);
  assert.ok(block.includes("## Files read (this send)"));
  assert.ok(block.includes("## Files modified (this send)"));
  assert.ok(block.includes("src/x.ts"));
  assert.ok(block.includes("src/y.ts"));
});
