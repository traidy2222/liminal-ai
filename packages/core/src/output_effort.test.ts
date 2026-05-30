import test from "node:test";
import assert from "node:assert/strict";
import {
  parseEffortLevel,
  resolveEffortLevel,
  buildEffortDirective,
  buildEffortTurnInjection,
  scaleMaxCompletionTokensForEffort,
  formatOutputEffortTraceLine,
  DEFAULT_EFFORT_LEVEL,
  type EffortLevel,
} from "./output_effort.js";

const LEVELS: EffortLevel[] = ["low", "medium", "high", "xhigh"];

test("parseEffortLevel accepts valid levels (case/space-insensitive), rejects junk", () => {
  assert.equal(parseEffortLevel("low"), "low");
  assert.equal(parseEffortLevel(" HIGH "), "high");
  assert.equal(parseEffortLevel("xhigh"), "xhigh");
  assert.equal(parseEffortLevel("ultra"), null);
  assert.equal(parseEffortLevel(""), null);
  assert.equal(parseEffortLevel(undefined), null);
  assert.equal(parseEffortLevel(3), null);
});

test("resolveEffortLevel reads AGENT_EFFORT and defaults to medium", () => {
  const prev = process.env["AGENT_EFFORT"];
  try {
    delete process.env["AGENT_EFFORT"];
    assert.equal(resolveEffortLevel(), DEFAULT_EFFORT_LEVEL);
    assert.equal(DEFAULT_EFFORT_LEVEL, "medium");

    process.env["AGENT_EFFORT"] = "xhigh";
    assert.equal(resolveEffortLevel(), "xhigh");

    process.env["AGENT_EFFORT"] = "nonsense";
    assert.equal(resolveEffortLevel(), "medium"); // invalid → default
  } finally {
    if (prev === undefined) delete process.env["AGENT_EFFORT"];
    else process.env["AGENT_EFFORT"] = prev;
  }
});

test("buildEffortDirective emits the framing line + the active level's contract", () => {
  for (const level of LEVELS) {
    const d = buildEffortDirective(level);
    assert.ok(d.includes("[OUTPUT EFFORT]"), `${level} should carry the framing tag`);
    assert.match(d.replace(/\s+/g, " "), /independent of internal reasoning depth/, `${level} should state reasoning-independence`);
    assert.match(d, new RegExp(`Level ${level}\\b`));
  }
});

test("the four contracts are distinct and output-shaped", () => {
  const outs = LEVELS.map(buildEffortDirective);
  assert.equal(new Set(outs).size, 4, "each level must produce a distinct directive");
  assert.match(buildEffortDirective("low"), /shortest correct response/i);
  assert.match(buildEffortDirective("xhigh"), /edge cases and failure/i);
  // Effort is about the deliverable, not raw verbosity.
  assert.match(buildEffortDirective("xhigh"), /substance over length/i);
});

test("buildEffortTurnInjection includes directive and level-specific turn notes", () => {
  const low = buildEffortTurnInjection("low");
  assert.match(low, /\[OUTPUT EFFORT\]/);
  assert.match(low, /Deliverable minimalism/i);

  const med = buildEffortTurnInjection("medium");
  assert.match(med, /Level medium\b/);
  assert.doesNotMatch(med, /turn overrides/i);

  const high = buildEffortTurnInjection("high");
  assert.match(high, /\[OUTPUT EFFORT — turn overrides\]/);
  assert.match(high, /R-EXECUTIVE-READ/i);

  const xh = buildEffortTurnInjection("xhigh");
  assert.match(xh, /Level xhigh\b/);
  assert.match(xh, /turn overrides/i);
});

test("scaleMaxCompletionTokensForEffort applies multipliers and low floor", () => {
  assert.equal(scaleMaxCompletionTokensForEffort(4000, "medium"), 4000);
  assert.equal(scaleMaxCompletionTokensForEffort(4000, "high"), 5000);
  assert.equal(scaleMaxCompletionTokensForEffort(4000, "xhigh"), 6000);
  assert.equal(scaleMaxCompletionTokensForEffort(4000, "low"), 3000);
  assert.equal(scaleMaxCompletionTokensForEffort(800, "low"), 1024);
});

test("formatOutputEffortTraceLine", () => {
  assert.equal(formatOutputEffortTraceLine("xhigh"), "[output_effort: level=xhigh]\n");
});
