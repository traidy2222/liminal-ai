import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveReasoningSurface,
  shouldSendOpenRouterReasoningParam,
  isImplementShipUserMessage,
  isResearchFreshnessUserMessage,
  isBuildDeliverableUserMessage,
  applySurfaceToBudget,
} from "./reasoning_surface.js";
import { fallbackReasoningBudget } from "./reasoning_profile.js";

test("deepseek slug resolves external by default (native disabled)", () => {
  const prev = process.env["AGENT_REASONING_SURFACE"];
  process.env["AGENT_REASONING_SURFACE"] = "auto";
  try {
    const r = resolveReasoningSurface("deepseek/deepseek-v4-pro");
    assert.equal(r.surface, "external");
  } finally {
    if (prev === undefined) delete process.env["AGENT_REASONING_SURFACE"];
    else process.env["AGENT_REASONING_SURFACE"] = prev;
  }
});

test("claude-like slug resolves external by default", () => {
  const prev = process.env["AGENT_REASONING_SURFACE"];
  process.env["AGENT_REASONING_SURFACE"] = "auto";
  try {
    const r = resolveReasoningSurface("anthropic/claude-3.5-sonnet");
    assert.equal(r.surface, "external");
  } finally {
    if (prev === undefined) delete process.env["AGENT_REASONING_SURFACE"];
    else process.env["AGENT_REASONING_SURFACE"] = prev;
  }
});

test("AGENT_REASONING_SURFACE=external forces external", () => {
  const prev = process.env["AGENT_REASONING_SURFACE"];
  process.env["AGENT_REASONING_SURFACE"] = "external";
  try {
    assert.equal(resolveReasoningSurface("deepseek/deepseek-v4-pro").surface, "external");
    assert.equal(shouldSendOpenRouterReasoningParam("external"), false);
  } finally {
    if (prev === undefined) delete process.env["AGENT_REASONING_SURFACE"];
    else process.env["AGENT_REASONING_SURFACE"] = prev;
  }
});

test("applySurfaceToBudget caps think on native toolFirst", () => {
  const b = applySurfaceToBudget(fallbackReasoningBudget("coding", false), "native");
  assert.equal(b.thinkDepth, "brief");
});

test("isImplementShipUserMessage detects TSP implement", () => {
  assert.equal(
    isImplementShipUserMessage("zero-shot implement TSP algorithm in Python and test"),
    true
  );
});

test("isResearchFreshnessUserMessage detects current-events prompts", () => {
  assert.equal(isResearchFreshnessUserMessage("update yourself on whats going on with iran"), true);
  assert.equal(isResearchFreshnessUserMessage("explain quantum computing"), false);
});

test("isBuildDeliverableUserMessage detects build prompts", () => {
  assert.equal(isBuildDeliverableUserMessage("build something for yourself"), true);
  assert.equal(isBuildDeliverableUserMessage("if you could build one thing"), false);
});
