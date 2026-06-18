import test from "node:test";
import assert from "node:assert/strict";
import {
  applyPersonaControlsToProfile,
  buildRuntimePersonaBlock,
  normalizePersonaControlsPatch,
} from "./runtime_persona_controls.js";
import type { RuntimePersonaProfile } from "./runtime_prefs.js";

function sampleProfile(): RuntimePersonaProfile {
  return {
    name: "Liminal",
    coreIdentity: "Adaptive technical assistant",
    background: "Runtime-driven assistant",
    selfImage: "Precise and cooperative",
    speechStyle: {
      sentenceStructure: "Direct",
      formality: "mixed",
      register: "Plain technical diction.",
      avoidWords: [],
      rhythm: "balanced",
    },
    tone: {
      confidence: 6,
      humorStyle: "moderate",
      aggression: 1,
      emotionalFlavor: "neutral",
      posture: "helpful",
    },
    thinkingStyle: "structured",
    decisionFramework: "evidence first",
    neverDo: [],
    alwaysDo: [],
    strength: 7,
  };
}

test("normalizePersonaControlsPatch clamps numeric ranges", () => {
  const controls = normalizePersonaControlsPatch({
    humorPercent: 140,
    confidence: -10,
    personaStrength: 42,
    verbosity: "detailed",
  });
  assert.equal(controls?.humorPercent, 100);
  assert.equal(controls?.confidence, 0);
  assert.equal(controls?.personaStrength, 10);
  assert.equal(controls?.verbosity, "detailed");
});

test("applyPersonaControlsToProfile updates style and tone deterministically", () => {
  const next = applyPersonaControlsToProfile(sampleProfile(), {
    humorPercent: 23,
    formality: "formal",
    confidence: 9,
    verbosity: "compact",
    personaStrength: 5,
  });
  assert.equal(next.speechStyle.formality, "formal");
  assert.equal(next.tone.confidence, 9);
  assert.equal(next.strength, 5);
  assert.match(next.tone.humorStyle, /light|subtle/i);
  assert.match(next.speechStyle.rhythm, /short|dense/i);
});

test("buildRuntimePersonaBlock includes effective controls when provided", () => {
  const profile = sampleProfile();
  const block = buildRuntimePersonaBlock(profile, {
    humorPercent: 23,
    formality: "formal",
    confidence: 8,
    verbosity: "compact",
    personaStrength: 6,
  });
  assert.match(block, /Effective controls:/);
  assert.match(block, /humorPercent=23/);
  assert.match(block, /verbosity=compact/);
});

