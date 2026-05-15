import test from "node:test";
import assert from "node:assert/strict";
import {
  appendEpistemicHypothesis,
  emptyEpistemicState,
  mergeEpistemicState,
  renderEpistemicStateBlock,
} from "./epistemic_state.js";
import type { EpistemicHypothesisRow } from "./epistemic_state.js";

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

test("appendEpistemicHypothesis supersedes by id and render shows falsifiers", () => {
  const base = emptyEpistemicState("goal");
  const h1: EpistemicHypothesisRow = {
    id: "hyp:aaa",
    claim: "First theory",
    confidence: "low",
    falsifiers: ["if logs show X"],
    status: "active",
  };
  const h2: EpistemicHypothesisRow = {
    id: "hyp:bbb",
    claim: "Revised theory",
    confidence: "med",
    status: "active",
  };
  let hy = appendEpistemicHypothesis(base.hypotheses, h1);
  hy = appendEpistemicHypothesis(hy, h2, { supersede_id: "hyp:aaa" });
  assert.equal(hy.length, 2);
  assert.equal(hy[0]?.status, "superseded");
  assert.equal(hy[0]?.superseded_by, "hyp:bbb");
  const block = renderEpistemicStateBlock(mergeEpistemicState(base, { hypotheses: hy }));
  assert.ok(block.includes("falsify-if"));
  assert.ok(block.includes("hyp:bbb"));
});
