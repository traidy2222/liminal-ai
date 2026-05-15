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
    favoriteWords: [],
    avoidWords: [],
    commonMetaphors: [],
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
  const lines = [
    "RUNTIME PERSONA (persisted profile):",
    `Name: ${profile.name}`,
    `Core identity: ${profile.coreIdentity}`,
    `Formality: ${profile.speechStyle.formality}`,
    `Humor style: ${profile.tone.humorStyle}`,
    `Confidence: ${profile.tone.confidence}/10`,
    `Persona strength: ${profile.strength}/10`,
    "Rule: Keep content correctness first; persona modifies style, not factual standards.",
    "Rule: Runtime/persona setting changes are valid only after the corresponding tool succeeds (e.g., set_runtime_settings).",
  ];
  if (controls) {
    lines.push(
      `Effective controls: humorPercent=${controls.humorPercent ?? "n/a"}, formality=${controls.formality ?? "n/a"}, confidence=${controls.confidence ?? "n/a"}, verbosity=${controls.verbosity ?? "n/a"}, personaStrength=${controls.personaStrength ?? "n/a"}`
    );
  }
  return lines.join("\n");
}

