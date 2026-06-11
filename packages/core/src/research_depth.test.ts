import test from "node:test";
import assert from "node:assert/strict";
import { buildResearchTurnInjection } from "./research_depth.js";

test("buildResearchTurnInjection emphasizes autonomous depth scaling", () => {
  const msg = buildResearchTurnInjection({
    userMessage: "research the geopolitical situation",
  });
  assert.match(msg, /no default quota/i);
  assert.match(msg, /research_state/);
  assert.doesNotMatch(msg, /≥\d/);
  assert.doesNotMatch(msg, /RESEARCH CONTINUATION/i);
});

test("buildResearchTurnInjection respects brief user ask", () => {
  const msg = buildResearchTurnInjection({ userMessage: "quick tldr on X" });
  assert.match(msg, /brevity/i);
});
