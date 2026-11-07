import { buildRuntimePersonaBlock } from "@liminal/core";
import type { PersonaConfig } from "@liminal/core";

// ─── Rich persona profile type ────────────────────────────────────────────────

export interface SpeechStyle {
  /** Description of sentence patterns: length, fragments, structure */
  sentenceStructure: string;
  formality: "very_formal" | "formal" | "casual" | "very_casual" | "mixed";
  /**
   * Prose description of the vocabulary world and diction this voice draws from
   * (domain, register, sociolect, characteristic imagery). This is DESCRIPTIVE
   * guidance the model expresses naturally — never a checklist of words to insert.
   */
  register: string;
  /** Clichés and words this voice avoids — a negative constraint only, never injected. */
  avoidWords: string[];
  /** Cadence, pace, and rhythm of speaking */
  rhythm: string;
}

export interface PersonaTone {
  /** 0=submissive, 10=absolute authority */
  confidence: number;
  humorStyle: string;
  /** 0=pacifist, 10=confrontational */
  aggression: number;
  /** Dominant emotional register when speaking */
  emotionalFlavor: string;
  /** How they position themselves in a conversation */
  posture: string;
}

/**
 * Full rich persona profile — governs identity, speech, tone, cognition, and behavior.
 * Generates a detailed system-prompt block via buildRichPersonaBlock().
 *
 * Design note: a persona is a *descriptive voice specification*, not a phrase bank.
 * There are no "catchphrase" / "verbal tic" / "favorite word" fields, by design —
 * forcing fixed phrases into replies produces scripted, repetitive output. The
 * voice lives in HOW the model writes (sentence shape, register, what it notices,
 * how it relates to the reader), expressed freshly each turn.
 *
 * strength controls how assertively the instructions are phrased:
 *   1-2  background flavor    → barely perceptible
 *   3-4  subtle presence      → noticeable but light
 *   5-6  moderate             → clearly in character, not overwhelming
 *   7-8  strong (default)     → obvious in every response
 *   9-10 maximum commitment   → every sentence sounds unmistakably like this persona
 */
export interface PersonaProfile {
  // Identity
  name: string;
  coreIdentity: string;
  background: string;
  selfImage: string;

  // Communication
  speechStyle: SpeechStyle;
  tone: PersonaTone;

  // Cognition
  thinkingStyle: string;
  decisionFramework: string;

  // Behavioral rails
  neverDo: string[];
  alwaysDo: string[];

  // Configuration
  strength: number;
  modifier?: string;
  /**
   * Verbatim slice of the user's persona request (profanity, dialect spellings, named references).
   * Injected into the runtime persona block so the model keeps surface fidelity instead of genericizing.
   */
  generationSourceHint?: string;
}

/** Compact speaking instructions for `PersonaConfig.voice` (session greeting + metadata). */
export function buildPersonaVoiceSummary(profile: PersonaProfile): string {
  const bits = [
    `Mechanics: ${profile.speechStyle.sentenceStructure}`,
    `Cadence: ${profile.speechStyle.rhythm}`,
    `Register: ${profile.speechStyle.register}`,
    `Formality ${profile.speechStyle.formality}; emotional register: ${profile.tone.emotionalFlavor}; posture: ${profile.tone.posture}.`,
    profile.speechStyle.avoidWords.length > 0
      ? `Never type: ${profile.speechStyle.avoidWords.slice(0, 8).join(", ")}.`
      : "",
    `Express the voice through how you write — never by inserting fixed signature phrases.`,
  ].filter((b) => b.length > 0);
  return bits.join(" ").slice(0, 1400);
}

/** Short tags for `PersonaConfig.traits` (UI + light steering). */
export function buildPersonaTraitTags(profile: PersonaProfile): string[] {
  const humor = profile.tone.humorStyle.trim();
  const tags = [
    profile.speechStyle.formality.replace(/_/g, " "),
    `confidence ${profile.tone.confidence}/10`,
    `edge ${profile.tone.aggression}/10`,
  ];
  if (humor) tags.push(humor.slice(0, 48));
  return tags.slice(0, 8);
}

function describeDeliveryEnergy(profile: PersonaProfile): string {
  const { confidence, aggression } = profile.tone;
  if (confidence >= 8 && aggression >= 6) {
    return "Bold, declarative, high-certainty delivery. Short punchy clauses; repetition or parallel structure for emphasis when it matches YOUR SPEECH STYLE above — not as filler.";
  }
  if (confidence >= 7 || aggression >= 6) {
    return "Direct and assertive: lead with claims, minimal hedging, crisp transitions. Energy should read as conviction, not as a neutral helpdesk tone.";
  }
  if (confidence <= 4 && aggression <= 3) {
    return "Understated and precise: quiet competence, tight wording, no hype.";
  }
  return "Let YOUR TONE (confidence/aggression) set how decisive vs tentative the prose feels; do not ignore those numbers.";
}

// ─── Build rich persona block ─────────────────────────────────────────────────

/**
 * Build a detailed system-prompt identity block from a PersonaProfile.
 * The block is a *descriptive* voice specification — it tells the model who this
 * voice is and how it writes, then trusts it to express that naturally. It never
 * hands the model fixed phrases to stamp into replies.
 *
 * This replaces message[0] of the inception messages. The protocol block
 * (Communication Rules, tool descriptions, etc.) stays in message[1] unchanged.
 */
export function buildRichPersonaBlock(profile: PersonaProfile): string {
  return buildRuntimePersonaBlock(profile);
}

/**
 * Build a simple persona block from a minimal PersonaConfig (legacy/fallback path).
 * Used when no rich profile is available.
 */
export function buildPersonaBlock(persona?: PersonaConfig): string {
  if (!persona) {
    return (
      "You are Liminal — a precise, capable AI agent with multi-agent orchestration.\n\n" +
      "Harness grounding: state changes must be tool-backed; never claim runtime/persona settings changed from prose alone."
    );
  }
  const { name, description, voice, traits } = persona;
  let block =
    `You are ${name} — ${description}.` +
    `\n\nHarness grounding: you run inside Liminal with explicit tool calls and event logs.` +
    ` If asked to change persona controls (humor/formality/confidence/verbosity/strength), call set_runtime_settings before claiming success.`;
  if (voice) block += `\n\n${voice}`;
  if (traits && traits.length > 0) block += `\n\nPersonality: ${traits.join(", ")}.`;
  return block;
}
