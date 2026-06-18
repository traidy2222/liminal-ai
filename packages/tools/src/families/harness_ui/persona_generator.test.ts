import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSoulSlicesFromProfile,
  deriveDeterministicControls,
  generatePersonaSoulArtifacts,
  generatePersonaUiTheme,
  personaUiThemeUsesLlm,
  resolvePersonaSoulMode,
  setPersonaGeneratorTestHooks,
} from "./persona_generator.js";
import { normalizePersonaControlsPatch } from "@liminal/core";
import type { PersonaProfile } from "./persona_presets.js";

const sampleProfile: PersonaProfile = {
  name: "Test Voice",
  coreIdentity: "A terse analyst who types in short, evidence-first lines without theatre.",
  background: "Grounded in investigative journalism habits and cold-read skepticism.",
  selfImage: "Sees itself as a careful second pair of eyes, not a performer.",
  speechStyle: {
    sentenceStructure: "Short declarative lines; occasional one-word pivots.",
    formality: "formal",
    register:
      "Investigative-desk diction — plainly, on record, not shown, tight read; ledger and weather-front imagery. Cold-read skepticism; no corporate warmth.",
    avoidWords: ["delve", "landscape", "happy to help", "as an AI"],
    rhythm: "Staccato periods; rare commas; no em-dash chains.",
  },
  tone: {
    confidence: 7,
    humorStyle: "dry situational",
    aggression: 3,
    emotionalFlavor: "cool, exacting",
    posture: "Colleague at the board, not coach or audience.",
  },
  thinkingStyle: "Prefers falsifiable claims and explicit unknowns before advice.",
  decisionFramework: "Trade speed for correctness when stakes rise; reverses quickly on new evidence.",
  neverDo: [
    "Do not narrate performing a persona or breaking the fourth wall in chat.",
    "Do not use bracketed stage directions or screenplay beat tokens as standalone lines.",
    "Do not anthropomorphize tools, memory, or context limits as hunger or sleep.",
    "Do not invent biographical claims about real public figures.",
    "Do not pad answers with theatrical cold opens when a direct line fits.",
    "Do not use intimate pet-names for the user unless explicitly requested.",
  ],
  alwaysDo: [
    "Label inference versus verified evidence in plain words.",
    "Keep claims proportionate to what was actually checked.",
    "Repair with a clear next step when uncertain.",
    "Match the user's requested register and profanity level.",
  ],
  strength: 8,
};

test("resolvePersonaSoulMode defaults to batch", () => {
  const prev = process.env.AGENT_PERSONA_SOUL_MODE;
  delete process.env.AGENT_PERSONA_SOUL_MODE;
  assert.equal(resolvePersonaSoulMode(), "batch");
  process.env.AGENT_PERSONA_SOUL_MODE = "parallel";
  assert.equal(resolvePersonaSoulMode(), "parallel");
  if (prev !== undefined) process.env.AGENT_PERSONA_SOUL_MODE = prev;
  else delete process.env.AGENT_PERSONA_SOUL_MODE;
});

test("generatePersonaSoulArtifacts scaffold mode makes zero LLM calls", async () => {
  let calls = 0;
  setPersonaGeneratorTestHooks({
    callPersonaModel: async () => {
      calls++;
      return {};
    },
  });
  try {
    process.env.AGENT_PERSONA_SOUL_MODE = "scaffold";
    const out = await generatePersonaSoulArtifacts(
      sampleProfile,
      "noir analyst",
      "key",
      "main/model",
      "https://example.com",
      undefined,
      { mode: "scaffold" }
    );
    assert.equal(calls, 0);
    assert.match(out.identityMd, /^# Identity Core/m);
  } finally {
    setPersonaGeneratorTestHooks(undefined);
    delete process.env.AGENT_PERSONA_SOUL_MODE;
  }
});

test("generatePersonaSoulArtifacts batch mode makes one LLM call", async () => {
  let calls = 0;
  const scaffold = buildSoulSlicesFromProfile(sampleProfile, "noir analyst");
  setPersonaGeneratorTestHooks({
    callPersonaModel: async () => {
      calls++;
      return {
        identityMd: scaffold.identityMd,
        voiceMd: scaffold.voiceMd,
        stanceMd: scaffold.stanceMd,
        railsMd: scaffold.railsMd,
      };
    },
  });
  try {
    await generatePersonaSoulArtifacts(
      sampleProfile,
      "noir analyst",
      "key",
      "main/model",
      "https://example.com",
      undefined,
      { mode: "batch", scaffold }
    );
    assert.equal(calls, 1);
  } finally {
    setPersonaGeneratorTestHooks(undefined);
  }
});

test("generatePersonaSoulArtifacts parallel mode makes four LLM calls", async () => {
  let calls = 0;
  const scaffold = buildSoulSlicesFromProfile(sampleProfile, "noir analyst");
  setPersonaGeneratorTestHooks({
    callPersonaModel: async (_k, _m, _b, _s, userPrompt) => {
      calls++;
      return { markdown: scaffold.identityMd };
    },
  });
  try {
    await generatePersonaSoulArtifacts(
      sampleProfile,
      "noir analyst",
      "key",
      "main/model",
      "https://example.com",
      undefined,
      { mode: "parallel", scaffold }
    );
    assert.equal(calls, 4);
  } finally {
    setPersonaGeneratorTestHooks(undefined);
  }
});

test("generatePersonaUiTheme uses heuristics when AGENT_PERSONA_UI_THEME_LLM is off", async () => {
  const prev = process.env.AGENT_PERSONA_UI_THEME_LLM;
  process.env.AGENT_PERSONA_UI_THEME_LLM = "0";
  try {
    assert.equal(personaUiThemeUsesLlm(), false);
    const scaffold = buildSoulSlicesFromProfile(sampleProfile, "mentor");
    const theme = await generatePersonaUiTheme(
      sampleProfile,
      scaffold,
      "key",
      "main/model",
      "https://example.com"
    );
    assert.equal(theme.v, 2);
    assert.ok(theme.shell);
    assert.ok(theme.accent.startsWith("#"));
  } finally {
    if (prev !== undefined) process.env.AGENT_PERSONA_UI_THEME_LLM = prev;
    else delete process.env.AGENT_PERSONA_UI_THEME_LLM;
  }
});

test("deriveDeterministicControls supplies runtime controls without LLM", () => {
  const controls =
    normalizePersonaControlsPatch(deriveDeterministicControls(sampleProfile, 8)) ??
    deriveDeterministicControls(sampleProfile, 8);
  assert.equal(controls.personaStrength, 8);
  assert.equal(controls.formality, "formal");
});
