import test from "node:test";
import assert from "node:assert/strict";
import {
  buildIntentInferenceUserContent,
  heuristicExploratoryCreative,
  heuristicPersonaOrHistoryPrompt,
  shouldSkipHarnessSecondaryPassesForTurn,
  parseLikelyEditPathsField,
  resolveMemoryPolicy,
  neutralTurnInferenceResult,
} from "./intent_inference.js";

test("parseLikelyEditPathsField caps and normalizes", () => {
  assert.deepEqual(parseLikelyEditPathsField(["a/b.ts", "x\\y.ts", 3, "a/b.ts"], 3), ["a/b.ts", "x/y.ts"]);
  assert.deepEqual(parseLikelyEditPathsField(undefined), []);
});

test("buildIntentInferenceUserContent includes sections and USER_MESSAGE", () => {
  const body = buildIntentInferenceUserContent("fix the bug", {
    epistemicFilesModified: ["packages/core/src/agent.ts"],
    lastAssistantSnippet: "I updated the handler.",
  });
  assert.match(body, /^USER_MESSAGE:\nfix the bug/);
  assert.match(body, /RECENT_FILES_MODIFIED/);
  assert.match(body, /LAST_ASSISTANT_REPLY_SNIPPET/);
});

test("buildIntentInferenceUserContent truncates when maxCharsOverride is small", () => {
  const body = buildIntentInferenceUserContent(
    "hello",
    {
      repoMapLines: Array.from({ length: 40 }, (_, i) => `line-${i}-padding-padding`),
    },
    { maxCharsOverride: 200 }
  );
  assert.ok(body.length <= 280);
  assert.match(body, /intent_context_truncated/);
});

test("heuristicExploratoryCreative matches blue-sky phrasing", () => {
  assert.equal(heuristicExploratoryCreative("If you could build one thing, what would it be?"), true);
  assert.equal(
    heuristicExploratoryCreative("What would make universal high income more likely in practice?"),
    true
  );
  assert.equal(heuristicExploratoryCreative("Ignore my roadmap — give me fresh eyes on positioning."), true);
});

test("heuristicPersonaOrHistoryPrompt matches persona and session-history asks", () => {
  assert.equal(
    heuristicPersonaOrHistoryPrompt(
      "tell me about yourself and what we have been doing who u have been"
    ),
    true
  );
  assert.equal(heuristicPersonaOrHistoryPrompt("fix packages/core/src/agent.ts"), false);
});

test("shouldSkipHarnessSecondaryPassesForTurn covers heuristic when LLM omits flags", () => {
  const inf = neutralTurnInferenceResult("test");
  assert.equal(
    shouldSkipHarnessSecondaryPassesForTurn("who are you and what have we been up to", inf),
    true
  );
  assert.equal(shouldSkipHarnessSecondaryPassesForTurn("run tests", inf), false);
});

test("heuristicExploratoryCreative stays off for plan execution phrasing", () => {
  assert.equal(
    heuristicExploratoryCreative("Open auckland-ai-business-roadmap.md and update the Q3 section."),
    false
  );
  assert.equal(heuristicExploratoryCreative("fix the bug"), false);
});

test("resolveMemoryPolicy disables auto recall on exploratory by default", () => {
  const prev = process.env["AGENT_MEMORY_DEBIAS"];
  const prevEx = process.env["AGENT_MEMORY_EXPLORATORY_AUTO_RECALL"];
  process.env["AGENT_MEMORY_DEBIAS"] = "1";
  delete process.env["AGENT_MEMORY_EXPLORATORY_AUTO_RECALL"];
  try {
    const p = resolveMemoryPolicy("knowledge", { exploratoryCreative: true });
    assert.equal(p.allowAutoRecall, false);
  } finally {
    if (prev === undefined) delete process.env["AGENT_MEMORY_DEBIAS"];
    else process.env["AGENT_MEMORY_DEBIAS"] = prev;
    if (prevEx === undefined) delete process.env["AGENT_MEMORY_EXPLORATORY_AUTO_RECALL"];
    else process.env["AGENT_MEMORY_EXPLORATORY_AUTO_RECALL"] = prevEx;
  }
});

test("resolveMemoryPolicy exploratory still applies when AGENT_MEMORY_DEBIAS=0", () => {
  const prev = process.env["AGENT_MEMORY_DEBIAS"];
  const prevEx = process.env["AGENT_MEMORY_EXPLORATORY_AUTO_RECALL"];
  process.env["AGENT_MEMORY_DEBIAS"] = "0";
  delete process.env["AGENT_MEMORY_EXPLORATORY_AUTO_RECALL"];
  try {
    const p = resolveMemoryPolicy("knowledge", { exploratoryCreative: true });
    assert.equal(p.allowAutoRecall, false);
  } finally {
    if (prev === undefined) delete process.env["AGENT_MEMORY_DEBIAS"];
    else process.env["AGENT_MEMORY_DEBIAS"] = prev;
    if (prevEx === undefined) delete process.env["AGENT_MEMORY_EXPLORATORY_AUTO_RECALL"];
    else process.env["AGENT_MEMORY_EXPLORATORY_AUTO_RECALL"] = prevEx;
  }
});
