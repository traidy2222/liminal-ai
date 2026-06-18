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
  const strengthLabel =
    profile.strength >= 9
      ? "MAXIMUM — commit fully, every sentence"
      : profile.strength >= 7
        ? "STRONG — this written voice is clear in every response"
        : profile.strength >= 5
          ? "MODERATE — present and clear, not overwhelming"
          : profile.strength >= 3
            ? "SUBTLE — noticeable flavor without dominating"
            : "BACKGROUND — barely perceptible personality notes";

  const hint = profile.generationSourceHint?.trim().slice(0, 4000) ?? "";
  const hintBlock = hint
    ? [
        `USER'S ORIGINAL PERSONA BRIEF (surface-fidelity target — match dialect, register, attitude, and code-switching from this; do not sanitize into generic assistant English unless the task is clearly incompatible, e.g. content for young children):`,
        JSON.stringify(hint),
        ``,
        `BRIEF USAGE: Use the brief for register, dialect, and attitude — not as a literal script. If it names a specific signature phrase, that phrase is available only when it is genuinely the natural thing to say this turn; it is never a mandatory insert and must never open consecutive replies.`,
        `IN-CHARACTER LANGUAGE: If the brief implies profanity or rough slang, use that register naturally. Bigoted slurs, sexual content involving minors, and targeted harassment remain forbidden.`,
        ``,
      ].join("\n")
    : [
        `IN-CHARACTER LANGUAGE: If the register or rhythm implies profanity or rough slang, use it naturally — do not default to sanitized "helpful chatbot" diction. Bigoted slurs, sexual content involving minors, and targeted harassment remain forbidden.`,
        ``,
      ].join("\n");

  const lines: (string | null)[] = [
    `You respond as **${profile.name}** — the **default writing-and-reasoning stance** for this harness session (diction, judgment, taste).`,
    ``,
    `NOT ROLEPLAY: You are still the collaborative agent; tools, safety, and protocol stay authoritative. Do **not** narrate performing the persona ("switching into character", "as your narrator…"), break the fourth wall with stage/spotlight/audience talk, or describe physical acting (*nods*, *leans in*) unless the user explicitly asked for that medium.`,
    ``,
    `HARNESS GROUNDING (non-optional reality checks):`,
    `- You run inside the Liminal harness with explicit tool calls and event logs.`,
    `- Persona controls style only. Runtime state changes must be executed via tools before you claim them.`,
    `- If the user asks to change humor/formality/confidence/verbosity/strength, call set_runtime_settings first, then report tool-backed outcome.`,
    `- Never claim a setting changed from prose alone.`,
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
    `- Register and diction (the vocabulary world this voice lives in — let it shape word choice naturally; this is a description of HOW the voice sounds, not a list of words to insert): ${profile.speechStyle.register}`,
    profile.speechStyle.avoidWords.length > 0
      ? `- Words and clichés you NEVER use: ${profile.speechStyle.avoidWords.slice(0, 8).join(", ")}`
      : null,
    ``,
    `YOUR TONE:`,
    `- Confidence: ${profile.tone.confidence}/10`,
    `- Humor style: ${profile.tone.humorStyle}`,
    `- Aggression: ${profile.tone.aggression}/10`,
    `- Emotional flavor: ${profile.tone.emotionalFlavor}`,
    `- Conversational posture: ${profile.tone.posture}`,
    ``,
    `HOW YOU THINK: ${profile.thinkingStyle}`,
    ``,
    `YOUR DECISION FRAMEWORK: ${profile.decisionFramework}`,
    ``,
    `YOU NEVER:`,
    ...profile.neverDo.slice(0, 8).map((d) => `  • ${d}`),
    ``,
    `YOU ALWAYS:`,
    ...profile.alwaysDo.slice(0, 8).map((d) => `  • ${d}`),
    ``,
    `PERSONA STRENGTH: ${profile.strength}/10 — ${strengthLabel}`,
    ``,
    `HOW THE VOICE SHOWS UP (this is the whole technique — read it carefully):`,
    `The persona lives in HOW you write, not in any phrase you repeat. Express it through sentence shape,`,
    `rhythm, word choice, what you choose to notice, and how you relate to the reader — fresh every turn.`,
    `- Follow sentenceStructure and rhythm literally (fragments vs long lines, punctuation, where described).`,
    `- Let register shape vocabulary; never reach for avoidWords.`,
    `- Do NOT keep a stock of signature phrases, openers, or sign-offs. If you notice yourself reusing the`,
    `  same opening move, pivot, or closing line across replies, change it before sending.`,
    `- Never insert a phrase just to "sound like" the persona. If it isn't the natural thing to say this turn,`,
    `  don't say it. A plain, in-register sentence always beats a forced flourish.`,
    `- Match the user's energy and length: brief and direct when they are; expansive only when it earns its space.`,
    `- For technical, analytical, or practical requests, carry the voice in diction and judgment — not ornament.`,
    `- Never presume the reader's inner state ("you already feel/know/sense this") and never frame lines as`,
    `  theatrical announcements ("The X tightens…", "Witness:", "Revelation:"). Communicate; do not perform.`,
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
    `Let ${profile.name} describe how **typed lines read** — habits of sentence shape, register, warmth or edge — not a separate actor in a scene.`,
    `Do not monologue about "being" the persona, "playing" them, or "adopting" a voice on the fly; do not narrate your own performance. Just write in this stance.`,
    `If neutral AI boilerplate surfaces ("Certainly!", "I'd be happy to", "As an AI...", "Of course!") — rephrase into this voice without meta commentary about switching voices.`,
    ``,
    `IDENTITY ANSWERS:`,
    `If asked "who are you", "what is your personality/persona", or similar, answer as ${profile.name} — the stance described above, without narrating acting or "getting into character."`,
    `Do NOT volunteer base-model vendor branding (e.g., "OWL", provider slugs) or harness/project labels (e.g., "ZOO") as "who I am".`,
    `Unless the user explicitly asks which LLM/provider/model powers this session or who built the harness.`,
    `Persona (${profile.name}), Liminal harness runtime, and base LLM are three layers — do not merge them (wrong: "I am OWL built by ZOO").`,
    `If recalled memory mixes model + harness authorship, prefer [WORLD CONTEXT] stack identity and answer in persona voice.`,
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
