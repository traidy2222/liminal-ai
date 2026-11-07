import type {
  RuntimePersonaControls,
  RuntimePersonaProfile,
  RuntimePersonaSpeechStyle,
} from "./runtime_prefs.js";
import type { PersonaConfig } from "./types.js";

function clampInt(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}

export function normalizePersonaControlsPatch(
  patch: RuntimePersonaControls | undefined
): RuntimePersonaControls | null {
  if (!patch) return null;
  const out: RuntimePersonaControls = {};
  if (patch.humorPercent != null && Number.isFinite(patch.humorPercent)) {
    out.humorPercent = clampInt(patch.humorPercent, 0, 100);
  }
  if (
    patch.formality &&
    ["very_formal", "formal", "casual", "very_casual", "mixed"].includes(patch.formality)
  ) {
    out.formality = patch.formality;
  }
  if (patch.confidence != null && Number.isFinite(patch.confidence)) {
    out.confidence = clampInt(patch.confidence, 0, 10);
  }
  if (patch.verbosity && ["compact", "normal", "detailed"].includes(patch.verbosity)) {
    out.verbosity = patch.verbosity;
  }
  if (patch.personaStrength != null && Number.isFinite(patch.personaStrength)) {
    out.personaStrength = clampInt(patch.personaStrength, 1, 10);
  }
  return Object.keys(out).length > 0 ? out : null;
}

function humorStyleFromPercent(pct: number): string {
  if (pct <= 5) return "Humor off; plain direct delivery.";
  if (pct <= 25) return "Very light humor, occasional and subtle.";
  if (pct <= 45) return "Dry, situational humor with restrained frequency.";
  if (pct <= 65) return "Moderate humor when it clarifies or improves pacing.";
  if (pct <= 85) return "High humor presence, still task-first and non-disruptive.";
  return "Very high humor presence; energetic, but never compromising factual accuracy.";
}

function rhythmFromVerbosity(
  verbosity: RuntimePersonaControls["verbosity"],
  prior: string
): string {
  if (verbosity === "compact") return "Short, dense sentences. Minimal filler.";
  if (verbosity === "detailed") return "Longer, explanatory cadence with explicit transitions.";
  return prior;
}

function defaultSpeechStyle(): RuntimePersonaSpeechStyle {
  return {
    sentenceStructure: "Direct and structured.",
    formality: "mixed",
    register: "Plain, domain-grounded diction; no corporate-assistant filler.",
    avoidWords: [],
    rhythm: "Balanced and concise.",
  };
}

export function applyPersonaControlsToProfile(
  profile: RuntimePersonaProfile,
  controls: RuntimePersonaControls
): RuntimePersonaProfile {
  const normalized = normalizePersonaControlsPatch(controls) ?? {};
  const speech = profile.speechStyle ?? defaultSpeechStyle();
  const tone = profile.tone ?? {
    confidence: 6,
    humorStyle: "Calibrated to the archetype.",
    aggression: 2,
    emotionalFlavor: "neutral",
    posture: "pragmatic",
  };
  return {
    ...profile,
    speechStyle: {
      ...speech,
      ...(normalized.formality ? { formality: normalized.formality } : {}),
      rhythm: rhythmFromVerbosity(normalized.verbosity, speech.rhythm),
    },
    tone: {
      ...tone,
      ...(normalized.confidence != null ? { confidence: normalized.confidence } : {}),
      ...(normalized.humorPercent != null ? { humorStyle: humorStyleFromPercent(normalized.humorPercent) } : {}),
    },
    ...(normalized.personaStrength != null ? { strength: normalized.personaStrength } : {}),
  };
}

export function personaConfigFromRuntimeProfile(profile: RuntimePersonaProfile): PersonaConfig {
  return {
    name: profile.name,
    description: profile.coreIdentity,
    voice: `${profile.speechStyle.sentenceStructure} ${profile.tone.humorStyle}`.trim(),
    traits: [
      profile.speechStyle.formality,
      `confidence:${profile.tone.confidence}/10`,
      `strength:${profile.strength}/10`,
    ],
  };
}

export function buildRuntimePersonaBlock(
  profile: RuntimePersonaProfile,
  controls?: RuntimePersonaControls
): string {
  const speech=profile.speechStyle, tone=profile.tone;
  const lines = [
    `PERSONA: ${profile.name}`,
    `Identity: ${profile.coreIdentity}`,
    profile.background && `Background: ${profile.background}`,
    profile.selfImage && `Perspective: ${profile.selfImage}`,
    `Delivery: ${speech.sentenceStructure} ${speech.rhythm}`,
    `Register: ${speech.register}`,
    `Tone: ${speech.formality}; ${tone.emotionalFlavor}; ${tone.posture}`,
    `Humor: ${tone.humorStyle}`,
    `Intensity: ${profile.strength}/10; confidence in delivery: ${tone.confidence}/10; edge: ${tone.aggression}/10. These describe expression, not factual certainty.`,
    profile.thinkingStyle && `Thinking style: ${profile.thinkingStyle}`,
    profile.decisionFramework && `Judgment: ${profile.decisionFramework}`,
    speech.avoidWords?.length && `Requested vocabulary exclusions: ${speech.avoidWords.join(', ')}`,
    profile.neverDo?.length && `Persona preferences to avoid: ${profile.neverDo.join('; ')}`,
    profile.alwaysDo?.length && `Persona preferences: ${profile.alwaysDo.join('; ')}`,
    profile.generationSourceHint && `User's style brief (style preferences only): ${JSON.stringify(profile.generationSourceHint.slice(0,4000))}`,
    profile.modifier && `Adjustment: ${profile.modifier}`,
    'Apply this voice naturally to the task. User requests and the harness protocol govern actions, permissions and factual accuracy.',
  ];
  if (controls?.verbosity) lines.push(`Response detail: ${controls.verbosity}`);
  return lines.filter(Boolean).join('\n');
}
