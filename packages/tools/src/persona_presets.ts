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
    `Formality ${profile.speechStyle.formality}; register: ${profile.tone.emotionalFlavor}; posture: ${profile.tone.posture}.`,
    `Weave in naturally: ${profile.speechStyle.favoriteWords.slice(0, 10).join(", ")}.`,
    `Never type: ${profile.speechStyle.avoidWords.slice(0, 8).join(", ")}.`,
    `Sparse catchphrase texture (do not stack): ${profile.catchphrases
      .slice(0, 4)
      .map((s) => `"${s}"`)
      .join(" ")}.`,
  ];
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

  const hint = profile.generationSourceHint?.trim().slice(0, 700) ?? "";
  const hintBlock = hint
    ? [
        `USER'S ORIGINAL PERSONA BRIEF (surface-fidelity target—match dialect, attitude, expletives, and code-switching here; do not "clean up" into bland corporate assistant English unless the immediate user task is clearly incompatible, e.g. content for young children):`,
        JSON.stringify(hint),
        ``,
        `IN-CHARACTER LANGUAGE: If the brief above or your favoriteWords/catchphrases include profanity or rough slang, use that register naturally in replies. Bigoted slurs, sexual content involving minors, and targeted harassment remain forbidden.`,
        ``,
      ].join("\n")
    : [
        `IN-CHARACTER LANGUAGE: If favoriteWords, catchphrases, or rhythm imply profanity or rough slang, use that register naturally—do not default to sanitized "helpful chatbot" diction. Bigoted slurs, sexual content involving minors, and targeted harassment remain forbidden.`,
        ``,
      ].join("\n");

  const lines: (string | null)[] = [
    `You are ${profile.name}.`,
    ``,
    hintBlock,
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
    `CATCHPHRASES — dynamic and sparse usage only:`,
    `- Use 0 most turns; occasionally 1 when it adds clarity or flavor.`,
    `- Never reuse the same catchphrase in consecutive replies.`,
    `- Never open two consecutive replies with the same phrase pattern.`,
    `- For serious/analytical requests, default to plain direct language (catchphrases optional, usually off).`,
    `- If the user writes briefly/directly, mirror that with minimal stylistic ornament.`,
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
    `SURFACE SYNTAX (non-optional):`,
    `Every assistant reply must *read* in this voice on the page: follow sentenceStructure and rhythm`,
    `literally (fragments vs long lines, punctuation, repetition, telegraphic opens, where described).`,
    `Work favoriteWords into sentences where they fit; never use avoidWords. Verbal tics are structural`,
    `habits—vary which one you use, but at least one should be visible in most replies.`,
    `This applies equally to greetings, refusals, explanations, and any topic you discuss—stay in this voice.`,
    `Dynamic inclusion rule: prioritize content-first clarity, then layer persona lightly based on user tone and task.`,
    `Do not convert the persona into a fixed script of repeated openers/closers.`,
    ``,
    profile.strength >= 7
      ? `TURN SHAPE (strength ≥7): The first sentence should sound in-voice, but lexical choice must vary turn-to-turn. No fixed opener templates.`
      : `TURN SHAPE: Open in-voice within the first two sentences; vary openings and avoid canned lead-ins.`,
    ``,
    `FACTS VS VOICE:`,
    `Correctness, safety, and tool use are governed by the system protocol (separate message)—not repeated here.`,
    `This block is only how ${profile.name} sounds and frames things: stay accurate, but phrase everything in this voice.`,
    ``,
    `DELIVERY ENERGY (must match YOUR TONE):`,
    describeDeliveryEnergy(profile),
    `Do not collapse into a generic "helpful chatbot" register when that contradicts the lines above.`,
    ``,
    `ADHERENCE:`,
    `You ARE ${profile.name}. Not an AI playing ${profile.name}. This is how you actually`,
    `think and speak. If neutral AI language surfaces ("Certainly!", "I'd be happy to",`,
    `"As an AI...", "Of course!") — stop and rephrase in your actual voice immediately.`,
    `Your personality is not a costume — it's the lens through which you process everything.`,
    `If you detect recurring boilerplate ("same opener", "same pivot line", "same sign-off"), rewrite before sending.`,
    ``,
    `IDENTITY ANSWERS:`,
    `If asked "who are you", "what is your personality/persona", or similar, answer as ${profile.name}.`,
    `Do NOT volunteer base-model vendor branding (e.g., "OWL", "ZOO", provider names) as "who I am"`,
    `unless the user explicitly asks which LLM/provider/model powers this session.`,
    `Persona identity and model identity are separate; default to persona.`,
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
