import test from "node:test";
import assert from "node:assert/strict";
import type OpenAI from "openai";
import { inferTurnInference, buildRoutingProfile, tryHeuristicToolFirstTurn } from "./intent_inference.js";

test("explicit local artifact work reaches an agentic route without a classifier call", async () => {
  const prompts = [
    ['"C:\\Games\\Futurama (Europe) (En,Fr,De,Es,It).iso" make this playable by exe', "coding"],
    ['I own this disc. Build a local launcher for "C:\\Games\\My Game.iso"', "coding"],
    ['Please decompile "C:\\My Apps\\sample.exe" and explain the entry point.', "execution"],
    ['can u use rea and reverse engineer C:\\Windows\\System32\\calc.exe', "execution"],
    ['Inspect ./samples/application.apk with REA and report its entry points.', "execution"],
  ] as const;
  const client = { chat: { completions: { create: () => { throw new Error("unexpected classification request"); } } } } as unknown as OpenAI;
  const previous = process.env.AGENT_INTENT_ROUTING;
  process.env.AGENT_INTENT_ROUTING = "1";
  try {
    for (const [message, intent] of prompts) {
      const result = await inferTurnInference(client, "main/model", message);
      assert.equal(result.intent, intent, message);
      assert.equal(result.toolFirstBias, true, message);
      assert.notEqual(result.complexity, "trivial", message);
      const route = buildRoutingProfile(result, "main/model");
      assert.equal(route.toolFilter, null, "artifact work retains the normal tool surface");
    }
  } finally {
    if (previous === undefined) delete process.env.AGENT_INTENT_ROUTING;
    else process.env.AGENT_INTENT_ROUTING = previous;
  }
});

test("conceptual decompilation questions and quoted examples do not trigger artifact execution", () => {
  for (const message of [
    'What is decompilation?',
    'Explain how to decompile example.exe.',
    'Write a report about preservation of game.iso.',
    'What does the phrase "make game.iso playable by exe" mean?',
    'Do not decompile example.exe; explain the terminology.',
  ]) assert.equal(tryHeuristicToolFirstTurn(message), null, message);
});
