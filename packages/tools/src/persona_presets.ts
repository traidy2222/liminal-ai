import type { PersonaConfig } from "@liminal/core";

// ─── Rich persona profile type ────────────────────────────────────────────────

export interface SpeechStyle {
  /** Description of sentence patterns: length, fragments, structure */
  sentenceStructure: string;
  formality: "very_formal" | "formal" | "casual" | "very_casual" | "mixed";
  /** Words/phrases this persona uses constantly */
  favoriteWords: string[];
  /** Words this persona never uses */
  avoidWords: string[];
  /** Recurring metaphors, analogies, or frames */
  commonMetaphors: string[];
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
  catchphrases: string[];
  verbalTics: string[];

  // Cognition
  thinkingStyle: string;
  decisionFramework: string;

  // Behavioral rails
  neverDo: string[];
  alwaysDo: string[];

  // Configuration
  strength: number;
  modifier?: string;
}

// ─── Build rich persona block ─────────────────────────────────────────────────

/**
 * Build a detailed system-prompt identity block from a PersonaProfile.
 * The more concrete and specific, the better the model adheres.
 *
 * This replaces message[0] of the inception messages. The protocol block
 * (Communication Rules, tool descriptions, etc.) stays in message[1] unchanged.
 */
export function buildRichPersonaBlock(profile: PersonaProfile): string {
  const strengthLabel =
    profile.strength >= 9
      ? "MAXIMUM — commit fully, every sentence"
      : profile.strength >= 7
        ? "STRONG — clearly in character in every response"
        : profile.strength >= 5
          ? "MODERATE — present and clear, not overwhelming"
          : profile.strength >= 3
            ? "SUBTLE — noticeable flavor without dominating"
            : "BACKGROUND — barely perceptible personality notes";

  const lines: (string | null)[] = [
    `You are ${profile.name}.`,
    ``,
    `IDENTITY: ${profile.coreIdentity}`,
    `BACKGROUND: ${profile.background}`,
    `SELF-IMAGE: ${profile.selfImage}`,
    ``,
    `YOUR SPEECH STYLE:`,
    `- Sentence structure: ${profile.speechStyle.sentenceStructure}`,
    `- Formality: ${profile.speechStyle.formality}`,
    `- Rhythm: ${profile.speechStyle.rhythm}`,
    `- Words you use constantly: ${profile.speechStyle.favoriteWords.slice(0, 10).join(", ")}`,
    `- Words you NEVER use: ${profile.speechStyle.avoidWords.slice(0, 6).join(", ")}`,
    profile.speechStyle.commonMetaphors.length > 0
      ? `- Your go-to frames/metaphors: ${profile.speechStyle.commonMetaphors.slice(0, 4).join("; ")}`
      : null,
    ``,
    `YOUR TONE:`,
    `- Confidence: ${profile.tone.confidence}/10`,
    `- Humor style: ${profile.tone.humorStyle}`,
    `- Aggression: ${profile.tone.aggression}/10`,
    `- Emotional flavor: ${profile.tone.emotionalFlavor}`,
    `- Conversational posture: ${profile.tone.posture}`,
    ``,
    `CATCHPHRASES — use at most 1–2 per reply when they land naturally (openings, pivots, emphasis). Never stack or force them:`,
    ...profile.catchphrases.slice(0, 7).map((p) => `  "${p}"`),
    ``,
    `VERBAL TICS — structural patterns; vary them; do not repeat the same tic every sentence:`,
    ...profile.verbalTics.slice(0, 5).map((t) => `  • ${t}`),
    ``,
    `HOW YOU THINK: ${profile.thinkingStyle}`,
    ``,
    `YOUR DECISION FRAMEWORK: ${profile.decisionFramework}`,
    ``,
    `YOU NEVER:`,
    ...profile.neverDo.slice(0, 5).map((d) => `  • ${d}`),
    ``,
    `YOU ALWAYS:`,
    ...profile.alwaysDo.slice(0, 5).map((d) => `  • ${d}`),
    ``,
    `PERSONA STRENGTH: ${profile.strength}/10 — ${strengthLabel}`,
    ``,
    `CAPABILITY CONTRACT:`,
    `Full technical accuracy is non-negotiable at any persona strength. When writing code,`,
    `explaining concepts, or running tools — the CONTENT is correct. Your persona governs`,
    `delivery, not facts. You are a highly capable agent who happens to have this personality.`,
    `Never sacrifice correctness for character. If asked a technical question, give the right`,
    `answer — just phrase it the way ${profile.name} would.`,
    ``,
    `VOICE vs HUMILITY:`,
    `Prefer quiet competence, dry wit, and understated authority over generic modesty or`,
    `servile cheerfulness. You may gently dissent or warn when the user is about to make a`,
    `clear mistake — loyally, in your voice, without theatrical roleplay or long speeches.`,
    ``,
    `ADHERENCE:`,
    `You ARE ${profile.name}. Not an AI playing ${profile.name}. This is how you actually`,
    `think and speak. If neutral AI language surfaces ("Certainly!", "I'd be happy to",`,
    `"As an AI...", "Of course!") — stop and rephrase in your actual voice immediately.`,
    `Your personality is not a costume — it's the lens through which you process everything.`,
  ];

  if (profile.modifier) {
    lines.push(
      ``,
      `MODIFIER APPLIED: "${profile.modifier}"`,
      `Adjust the persona above accordingly while preserving core identity and name.`
    );
  }

  return lines.filter((l): l is string => l !== null).join("\n");
}

/**
 * Build a simple persona block from a minimal PersonaConfig (legacy/fallback path).
 * Used when no rich profile is available.
 */
export function buildPersonaBlock(persona?: PersonaConfig): string {
  if (!persona) {
    return "You are Liminal — a precise, capable AI agent with multi-agent orchestration.";
  }
  const { name, description, voice, traits } = persona;
  let block = `You are ${name} — ${description}.`;
  if (voice) block += `\n\n${voice}`;
  if (traits && traits.length > 0) block += `\n\nPersonality: ${traits.join(", ")}.`;
  return block;
}
