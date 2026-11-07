import test from "node:test";
import { AgentHarness } from "./agent.js";
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

test("buildRuntimePersonaBlock preserves delivery and only describes requested controls", () => {
  const profile = sampleProfile();
  const block = buildRuntimePersonaBlock(profile, {
    humorPercent: 23,
    formality: "formal",
    confidence: 8,
    verbosity: "compact",
    personaStrength: 6,
  });
  assert.match(block, /Plain technical diction/);
  assert.match(block, /Response detail: compact/);
  assert.doesNotMatch(block, /Rule:|YOU ALWAYS|YOU NEVER/);
});



test('preference saves and targeted controls retain the complete generated voice', async()=>{
 const profile=sampleProfile();profile.speechStyle.rhythm='Distinctive rolling cadence';profile.tone.humorStyle='Quiet botanical puns';profile.generationSourceHint='Warm, patient, with long flowing sentences';
 const harness=new AgentHarness({openRouterApiKey:'offline',model:'offline',baseURL:'http://127.0.0.1:1',worldContext:{disabled:true},proceduralMemory:{enabled:false},context:{inceptionMessages:[{role:'system',content:'Fixture'},{role:'system',content:'Protocol'}],modelMaxTokens:100000,thresholdFraction:0.9},runtimePreferences:{version:1,updatedAt:0}});
 harness.setPersona({name:profile.name,description:profile.coreIdentity},buildRuntimePersonaBlock(profile),'Experience note: preserve continuity');
 await harness.patchRuntimePreferences({persona:{activeProfile:profile,controls:{humorPercent:23}}},{persist:false});
 const read=async()=>JSON.stringify(await harness.getContext().buildMessages());
 assert.match(await read(),/Distinctive rolling cadence/);assert.match(await read(),/Quiet botanical puns/);
 await harness.patchRuntimePreferences({harness:{env:{AGENT_TTS_ENABLED:'0'}}},{persist:false});
 assert.match(await read(),/Distinctive rolling cadence/);assert.match(await read(),/Experience note: preserve continuity/);
 await harness.patchRuntimePreferences({persona:{controls:{confidence:8}}},{persist:false});
 assert.match(await read(),/Quiet botanical puns/);assert.equal(harness.getRuntimePreferences()?.persona?.activeProfile?.tone.confidence,8);
});
