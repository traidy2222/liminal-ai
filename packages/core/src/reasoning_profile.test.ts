import assert from "node:assert/strict";
import test from "node:test";
import {
  fallbackReasoningBudget,
  resolveReasoningBudget,
  buildReasoningBudgetInjection,
  buildOpenRouterReasoningParam,
  resolveReasoningStallNudgeThresholdChars,
  parseReasoningBudgetFromParsed,
  tightenReasoningBudgetForUserMessage,
} from "./reasoning_profile.js";

test("fallbackReasoningBudget defaults coding to configured effort brief toolFirst", () => {
  const b = fallbackReasoningBudget("coding", false);
  assert.equal(b.reasoningEffort, "medium");
  assert.equal(b.thinkDepth, "brief");
  assert.equal(b.toolFirstBias, true);
  assert.ok(b.reasoningWordBudget <= 200);
});

test("resolveReasoningBudget uses LLM fields when complete", () => {
  const b = resolveReasoningBudget({
    intent: "coding",
    reasoningEffort: "high",
    thinkDepth: "brief",
    toolFirstBias: true,
    reasoningWordBudget: 100,
    essayRisk: true,
    reasoningBudgetSource: "llm",
  });
  assert.equal(b.source, "llm");
  assert.equal(b.reasoningWordBudget, 100);
});

test("buildOpenRouterReasoningParam maps effort on native surface", () => {
  assert.deepEqual(
    buildOpenRouterReasoningParam(fallbackReasoningBudget("knowledge", false), "native"),
    { reasoning: { effort: "medium" } }
  );
});

test("buildOpenRouterReasoningParam returns empty on external surface", () => {
  assert.deepEqual(
    buildOpenRouterReasoningParam(fallbackReasoningBudget("knowledge", false), "external"),
    {}
  );
});

test("buildReasoningBudgetInjection mentions tool-first when biased", () => {
  const inj = buildReasoningBudgetInjection(fallbackReasoningBudget("execution", false));
  assert.match(inj, /\[REASONING BUDGET\]/);
  assert.match(inj, /toolFirst=yes/i);
});

test("parseReasoningBudgetFromParsed", () => {
  const p = parseReasoningBudgetFromParsed({
    reasoningEffort: "high",
    thinkDepth: "brief",
    toolFirstBias: true,
    reasoningWordBudget: 150,
    essayRisk: true,
  });
  assert.equal(p.reasoningBudgetSource, "llm");
  assert.equal(p.reasoningWordBudget, 150);
});

test("stall nudge threshold uses aggressive cap for tool-first coding", () => {
  const b = fallbackReasoningBudget("coding", false);
  const t = resolveReasoningStallNudgeThresholdChars(b);
  assert.ok(t <= 900, `expected aggressive threshold, got ${t}`);
  assert.ok(t >= 450);
});

test("fallbackReasoningBudget research is tool-first brief", () => {
  const b = fallbackReasoningBudget("research", false);
  assert.equal(b.toolFirstBias, true);
  assert.equal(b.thinkDepth, "brief");
  assert.ok(b.reasoningWordBudget <= 200);
});

test("tightenReasoningBudgetForUserMessage clamps Iran research", () => {
  const base = fallbackReasoningBudget("knowledge", false);
  const t = tightenReasoningBudgetForUserMessage(base, "update yourself on whats going on with iran");
  assert.equal(t.toolFirstBias, true);
  assert.ok(t.reasoningWordBudget <= 140);
});

test("tightenReasoningBudgetForUserMessage clamps TSP implement trap", () => {
  const base = fallbackReasoningBudget("knowledge", false);
  const t = tightenReasoningBudgetForUserMessage(
    base,
    "zero-shot implement TSP algorithm in Python and test on 50 cities"
  );
  assert.equal(t.toolFirstBias, true);
  assert.ok(t.reasoningWordBudget <= 120);
  assert.equal(t.essayRisk, true);
});

test("buildOpenRouterReasoningParam sets max_tokens for tool-first", () => {
  const b = fallbackReasoningBudget("coding", false);
  const p = buildOpenRouterReasoningParam(b);
  assert.ok("reasoning" in p && p.reasoning.max_tokens != null && p.reasoning.max_tokens <= 1536);
});
