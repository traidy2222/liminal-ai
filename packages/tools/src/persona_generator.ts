import OpenAI from "openai";
import {
  completeChatJson,
  getFastModelSlug,
  normalizePersonaControlsPatch,
  withProviderRequestSpacing,
  type RuntimePersonaControls,
} from "@liminal/core";
import type { PersonaProfile } from "./persona_presets.js";
export type PersonaProgressFn = (stage: string, message: string) => void;

export interface PersonaGenerationBundle {
  profile: PersonaProfile;
  defaultControls: RuntimePersonaControls;
}

/** LLM-inferred voice context (genre-agnostic); used to ground drafts and envelope-led fallbacks. */
export interface PersonaVoiceEnvelope {
  suggestedName: string | null;
  archetypeSummary: string;
  genreTags: string[];
  eraOrSetting: string | null;
  registerHint: PersonaProfile["speechStyle"]["formality"] | null;
  voiceNotes: string;
  homageToRealFigure: boolean;
  /** none = standard register; strong = frequent in-character profanity when user asked for it */
  profanityRegister: "none" | "mild" | "strong";
  /** Regional English, code-switching, class markers—concrete, user-grounded */
  sociolectNotes: string;
  lexicalSeeds: string[];
  suggestedCatchphrases: string[];
  metaphorSeeds: string[];
  rhythmHint: string;
  sentenceMechanicsHint: string;
  postureHint: string;
}

export interface PersonaSoulArtifacts {
  soulMarkdown: string;
  styleLexicon: {
    signaturePhrases: string[];
    openerPatterns: string[];
    transitionPatterns: string[];
    closingPatterns: string[];
    prohibitedPhrases: string[];
    cadenceNotes: string;
  };
}

/**
 * Generate a full rich PersonaProfile from a natural-language description.
 *
 * Calls the LLM with a detailed schema prompt: anti-roleplay, character-forward voice,
 * quiet competence over generic humility (per product quality bar).
 *
 * @param input      - Natural-language description (e.g. "dry British valet AI")
 * @param strength   - Persona strength 1-10 (default 8)
 * @param modifier   - Optional adjustment ("but less aggressive", "but more technical")
 * @param apiKey     - OpenRouter API key
 * @param model      - Model identifier
 * @param baseURL    - API base URL
 */
export async function generatePersonaProfile(
  input: string,
  strength: number,
  modifier: string | undefined,
  apiKey: string,
  model: string,
  baseURL: string,
  onProgress?: PersonaProgressFn
): Promise<PersonaProfile> {
  onProgress?.("profile_infer", "Inferring voice, genre, and register from your description...");
  let voiceEnvelope: PersonaVoiceEnvelope | null = null;
  try {
    voiceEnvelope = await inferPersonaVoiceEnvelope({
      input,
      modifier,
      apiKey,
      model,
      baseURL,
    });
  } catch {
    voiceEnvelope = null;
  }

  onProgress?.("profile_draft", "Generating initial persona draft...");
  let draftRaw: Record<string, unknown>;
  try {
    draftRaw = await requestPersonaDraft({
      input,
      strength,
      modifier,
      apiKey,
      model,
      baseURL,
      voiceEnvelope,
    });
  } catch {
    onProgress?.("profile_scaffold", "Model draft unavailable; building persona from your description locally...");
    draftRaw = buildFallbackDraftRaw(input, strength, modifier, voiceEnvelope);
  }

  let profile: PersonaProfile;
  try {
    profile = enforceStructuralRails(sanitizeProfile(draftRaw, input, strength, modifier, voiceEnvelope), input);
  } catch {
    onProgress?.("profile_scaffold", "Draft JSON was unusable; building persona from your description locally...");
    profile = enforceStructuralRails(
      sanitizeProfile(
        buildFallbackDraftRaw(input, strength, modifier, voiceEnvelope),
        input,
        strength,
        modifier,
        voiceEnvelope
      ),
      input
    );
  }

  for (let repairPass = 0; repairPass < 2; repairPass++) {
    const issues = getCriticalProfileIssues(profile);
    if (issues.length === 0) break;
    onProgress?.(
      "profile_repair",
      `Refining profile (pass ${repairPass + 1}/2): ${issues.slice(0, 2).join("; ")}`
    );
    try {
      const repairedRaw = await requestPersonaRepair({
        input,
        strength,
        modifier,
        draft: profile,
        issues,
        apiKey,
        model,
        baseURL,
        voiceEnvelope,
      });
      profile = enforceStructuralRails(sanitizeProfile(repairedRaw, input, strength, modifier, voiceEnvelope), input);
    } catch {
      onProgress?.("profile_fill", "Repair call failed; completing profile deterministically...");
      profile = ensureProfileComplete(profile, input, strength, modifier, voiceEnvelope);
      break;
    }
  }

  profile = ensureProfileComplete(profile, input, strength, modifier, voiceEnvelope);
  return profile;
}

export function deriveDeterministicControls(
  profile: PersonaProfile,
  strength: number
): RuntimePersonaControls {
  const formality = profile.speechStyle.formality;
  const confidence = Math.max(0, Math.min(10, Math.round(profile.tone.confidence)));
  const personaStrength = Math.max(1, Math.min(10, Math.round(profile.strength || strength)));
  let verbosity: RuntimePersonaControls["verbosity"] = "normal";
  const rhythm = profile.speechStyle.rhythm.toLowerCase();
  if (/short|dense|minimal|staccato|tight/.test(rhythm)) verbosity = "compact";
  else if (/long|explan|detailed|expanded/.test(rhythm)) verbosity = "detailed";

  let humorPercent = 40;
  const hs = profile.tone.humorStyle.toLowerCase();
  if (/off|none|plain/.test(hs)) humorPercent = 0;
  else if (/very light|subtle/.test(hs)) humorPercent = 20;
  else if (/dry|situational/.test(hs)) humorPercent = 35;
  else if (/moderate/.test(hs)) humorPercent = 55;
  else if (/high|very high|energetic/.test(hs)) humorPercent = 80;

  return { humorPercent, formality, confidence, verbosity, personaStrength };
}

async function requestPersonaDefaultControls(args: {
  profile: PersonaProfile;
  input: string;
  strength: number;
  modifier?: string;
  apiKey: string;
  model: string;
  baseURL: string;
}): Promise<RuntimePersonaControls> {
  const systemPrompt =
    "You infer runtime persona controls from a completed persona profile. Return JSON only with numeric/enum values.";
  const userPrompt = `Given this finalized persona profile, produce runtime controls that best match its natural written voice.

Persona profile JSON:
${JSON.stringify(args.profile, null, 2)}

Original request: "${args.input.slice(0, 1200)}"
Strength input: ${args.strength}/10
Modifier: ${args.modifier ? `"${args.modifier}"` : "null"}

Return JSON with exact keys:
{
  "humorPercent": 0-100,
  "formality": "very_formal|formal|casual|very_casual|mixed",
  "confidence": 0-10,
  "verbosity": "compact|normal|detailed",
  "personaStrength": 1-10
}

Rules:
- Match the profile's actual cadence/diction (phonetic feel), not generic defaults.
- humorPercent is frequency/intensity of humor in normal replies.
- Keep values coherent with profile.tone and profile.speechStyle.
- No prose, JSON only.`;

  const raw = await callPersonaModel(
    args.apiKey,
    getFastModelSlug(args.model),
    args.baseURL,
    systemPrompt,
    userPrompt,
    300,
    0.1
  );
  const normalized = normalizePersonaControlsPatch({
    humorPercent: Number(raw["humorPercent"]),
    formality: String(raw["formality"] ?? "") as RuntimePersonaControls["formality"],
    confidence: Number(raw["confidence"]),
    verbosity: String(raw["verbosity"] ?? "") as RuntimePersonaControls["verbosity"],
    personaStrength: Number(raw["personaStrength"]),
  });
  if (!normalized) throw new Error("controls_normalization_failed");
  return normalized;
}

export async function generatePersonaBundle(
  input: string,
  strength: number,
  modifier: string | undefined,
  apiKey: string,
  model: string,
  baseURL: string,
  onProgress?: PersonaProgressFn
): Promise<PersonaGenerationBundle> {
  const profile = await generatePersonaProfile(
    input,
    strength,
    modifier,
    apiKey,
    model,
    baseURL,
    onProgress
  );
  onProgress?.("controls_pass", "Generating runtime controls that match persona voice...");
  let defaultControls: RuntimePersonaControls;
  try {
    defaultControls = await requestPersonaDefaultControls({
      profile,
      input,
      strength,
      modifier,
      apiKey,
      model,
      baseURL,
    });
  } catch {
    defaultControls = deriveDeterministicControls(profile, strength);
  }
  const normalized = normalizePersonaControlsPatch(defaultControls) ?? deriveDeterministicControls(profile, strength);
  return { profile, defaultControls: normalized };
}

export async function generatePersonaSoulArtifacts(
  profile: PersonaProfile,
  input: string,
  apiKey: string,
  model: string,
  baseURL: string,
  onProgress?: PersonaProgressFn
): Promise<PersonaSoulArtifacts> {
  onProgress?.("soul_draft", "Generating soul blueprint and style lexicon...");
  const systemPrompt =
    "You are an identity-design writer for fictional character voices. Return JSON only. " +
    "Do not include markdown fences or prose outside JSON.";
  const userPrompt = `Create persona artifacts: identity + voice only (no product/runtime/tooling copy).

Original request: "${input}"
Persona profile JSON:
${JSON.stringify(profile, null, 2)}

Return JSON:
{
  "soulMarkdown": "A complete markdown file defining identity and voice. Must include these exact headings: # Identity Core, ## Voice DNA, ## Cognitive Stance, ## Relational Posture, ## Behavioral Rails, ## Identity Answers, ## Non-Negotiables. Under ## Voice DNA include a subsection '### Example written lines' with exactly 3 short in-character lines in full surface voice (meeting someone new; answering a vague question; closing a conversation). Do not mention shells, repos, tools, agents, APIs, or any assistant platform—only the character. Keep concrete and operational.",
  "styleLexicon": {
    "signaturePhrases": ["8-14 phrase-level expressions this persona naturally uses"],
    "openerPatterns": ["4-8 opening move patterns"],
    "transitionPatterns": ["4-8 transition move patterns"],
    "closingPatterns": ["4-8 close/landing patterns"],
    "prohibitedPhrases": ["8-16 phrases this persona should avoid"],
    "cadenceNotes": "Detailed rhythm mechanics for sentence and paragraph flow"
  }
}

Constraints:
- "soulMarkdown" must be highly specific and consistent with the profile.
- No stage directions like *nods*; voice rules describe how this character writes/speaks, not how software runs.
- Keep language actionable, not abstract.
- The three **Example written lines** must be unmistakably in-register—including **matching the profile's profanity level and sociolect** when favoriteWords/catchphrases imply vulgar or regional English. Do not produce sanitized placeholder lines. For historical homage, no fake diary entries or unattributed quotes; for real public figures, stylistic channeling only.
- Do not reference harnesses, tool lists, IDEs, providers, or model vendors unless the user explicitly asked for that class of detail.
- Do not reference model/vendor identity in persona identity rules unless explicitly asked.`;
  let raw: Record<string, unknown>;
  try {
    raw = await callPersonaModel(apiKey, model, baseURL, systemPrompt, userPrompt, 2000, 0.5);
  } catch {
    onProgress?.("soul_fallback", "Soul/lexicon model call failed; using profile-derived artifacts.");
    return buildSoulArtifactsFromProfile(profile, input);
  }
  const styleRaw = (raw["styleLexicon"] ?? {}) as Record<string, unknown>;
  const out: PersonaSoulArtifacts = {
    soulMarkdown: String(raw["soulMarkdown"] ?? "").replace(/\r/g, "").replace(/\\n/g, "\n").trim(),
    styleLexicon: {
      signaturePhrases: dedupeStrings(toStringArray(styleRaw["signaturePhrases"], 120)).slice(0, 16),
      openerPatterns: dedupeStrings(toStringArray(styleRaw["openerPatterns"], 120)).slice(0, 10),
      transitionPatterns: dedupeStrings(toStringArray(styleRaw["transitionPatterns"], 120)).slice(0, 10),
      closingPatterns: dedupeStrings(toStringArray(styleRaw["closingPatterns"], 120)).slice(0, 10),
      prohibitedPhrases: dedupeStrings(toStringArray(styleRaw["prohibitedPhrases"], 120)).slice(0, 20),
      cadenceNotes: sanitizeText(String(styleRaw["cadenceNotes"] ?? "")),
    },
  };
  if (!out.soulMarkdown.startsWith("# Identity Core")) {
    onProgress?.("soul_repair", "Repairing soul blueprint structure...");
    try {
      out.soulMarkdown = await requestSoulRepair(out.soulMarkdown, profile, input, apiKey, model, baseURL);
    } catch {
      /* fall through to scaffold */
    }
  }
  if (!out.soulMarkdown.startsWith("# Identity Core")) {
    onProgress?.("soul_fallback", "Applying structured soul scaffold from profile (model output incomplete)...");
    out.soulMarkdown = buildSoulScaffoldFromProfile(profile, input);
  }
  return out;
}

// ─── Sanitize and validate the parsed profile ─────────────────────────────────

/**
 * Deterministic structural fixes only (safety rails + minimum list sizes).
 * Does not replace model-authored identity; avoids hard 400s on minor omissions.
 */
function enforceStructuralRails(profile: PersonaProfile, userInput = ""): PersonaProfile {
  const neverDo = [...profile.neverDo];
  if (!neverDo.some((s) => /asterisk|\*does thing\*/i.test(s))) {
    neverDo.push("Use asterisk actions (*does thing*)");
  }
  if (!neverDo.some((s) => /monologue/i.test(s))) {
    neverDo.push("Write theatrical monologues or dramatic speeches");
  }

  const alwaysDo = [...profile.alwaysDo];
  if (!alwaysDo.some((s) => /accur/i.test(s) && /fact/i.test(s))) {
    alwaysDo.push("Stay accurate with facts: label guesses and keep strong claims proportionate to evidence at any persona strength");
  }

  const favoriteWords = dedupeStrings([...profile.speechStyle.favoriteWords]);
  const fromPhrases = [...profile.catchphrases, ...profile.verbalTics];
  let idx = 0;
  while (favoriteWords.length < 6 && idx < fromPhrases.length) {
    const w = sanitizeText(fromPhrases[idx]!).split(/\s+/).slice(0, 4).join(" ");
    if (w.length > 2) favoriteWords.push(w);
    idx++;
  }
  const lexPad = buildLexicalPadPoolFromPersona(userInput, profile);
  let li = 0;
  while (favoriteWords.length < 6 && li < lexPad.length) {
    const w = lexPad[li]!;
    if (!favoriteWords.some((x) => x.toLowerCase() === w.toLowerCase())) favoriteWords.push(w);
    li++;
  }

  const avoidWords = dedupeStrings([...profile.speechStyle.avoidWords]);
  const avoidPad = ["happy to help", "great question", "as an AI", "I'd love to"];
  for (const a of avoidPad) {
    if (avoidWords.length >= 4) break;
    if (!avoidWords.some((x) => x.toLowerCase() === a)) avoidWords.push(a);
  }

  const catchphrases = dedupeStrings([...profile.catchphrases]);
  const cpPad = [
    "Let me frame it this way.",
    "One constraint, then the path.",
    "Plainly—here is what I hold true.",
  ];
  for (const c of cpPad) {
    if (catchphrases.length >= 3) break;
    if (!catchphrases.includes(c)) catchphrases.push(c);
  }

  const verbalTics = dedupeStrings([...profile.verbalTics]);
  const vtPad = [
    "Open with the claim that matters most, then supporting detail.",
    "Use short labeled lists when comparing options.",
    "Land with what should happen next—no trailing filler.",
  ];
  for (const v of vtPad) {
    if (verbalTics.length >= 3) break;
    if (!verbalTics.includes(v)) verbalTics.push(v);
  }

  let thinkingStyle = profile.thinkingStyle.trim();
  if (thinkingStyle.length < 24) {
    thinkingStyle =
      `${thinkingStyle} Tradeoff default: favor correctness and explicit assumptions over speed.`.trim().slice(0, 260);
  }

  let decisionFramework = profile.decisionFramework.trim();
  if (decisionFramework.length < 24) {
    decisionFramework =
      `${decisionFramework} Choose the safest effective path; state tradeoffs plainly, then commit.`.trim().slice(0, 260);
  }

  let coreIdentity = profile.coreIdentity.trim();
  if (coreIdentity.length < 30 && profile.background.trim().length > 0) {
    coreIdentity = `${coreIdentity} ${profile.background}`.trim().slice(0, 260);
  }

  return {
    ...profile,
    coreIdentity,
    thinkingStyle,
    decisionFramework,
    catchphrases: catchphrases.slice(0, 10),
    verbalTics: verbalTics.slice(0, 8),
    neverDo: neverDo.slice(0, 6),
    alwaysDo: alwaysDo.slice(0, 6),
    speechStyle: {
      ...profile.speechStyle,
      favoriteWords: favoriteWords.slice(0, 12),
      avoidWords: avoidWords.slice(0, 12),
    },
  };
}

function isEnvelopeUsable(envelope: PersonaVoiceEnvelope): boolean {
  const textLen = envelope.archetypeSummary.length + envelope.voiceNotes.length;
  const seeds = envelope.lexicalSeeds.length + envelope.suggestedCatchphrases.length;
  return textLen >= 36 && seeds >= 5;
}

/** Fallback scaffold when inference succeeded—no fixed sci-fi/history/fantasy buckets. */
function buildEnvelopeLedFallbackDraftRaw(
  envelope: PersonaVoiceEnvelope,
  input: string,
  strength: number,
  modifier: string | undefined
): Record<string, unknown> {
  const blurbs = (input || "").trim().slice(0, 220) || "A custom voice the user described";
  const modNote = modifier?.trim() ? ` User adjustment: ${modifier.trim()}.` : "";
  const nameGuess = normalizePersonaName(input.split(/\s+/).filter(Boolean).slice(0, 3).join(" "));

  const avoidBase = [
    "happy to help",
    "great question",
    "I'd love to",
    "as an AI",
    "delve",
    "leverage",
    "synergy",
    "I apologize for the confusion",
    "circle back",
    "net-net",
  ];

  const genreLine =
    envelope.genreTags.length > 0 ? ` Voice tags: ${envelope.genreTags.slice(0, 8).join(", ")}.` : "";
  const eraLine = envelope.eraOrSetting ? ` Setting/era: ${envelope.eraOrSetting}.` : "";
  const socioLine = envelope.sociolectNotes ? ` Sociolect: ${envelope.sociolectNotes}.` : "";
  const profLine =
    envelope.profanityRegister !== "none"
      ? ` In-character profanity level: ${envelope.profanityRegister}—do not sanitize into polite assistant English.`
      : "";
  const homageLine = envelope.homageToRealFigure
    ? " Stylistic channeling only for any real public figure—no invented private facts or fake quotations."
    : "";

  const background = sanitizeText(
    `${envelope.archetypeSummary}${genreLine}${eraLine}${socioLine}${profLine} ${envelope.voiceNotes}${homageLine}`.slice(
      0,
      420
    )
  );
  const selfImage = sanitizeText(
    (envelope.postureHint || envelope.archetypeSummary).slice(0, 260)
  );

  const formality: PersonaProfile["speechStyle"]["formality"] = validateFormality(envelope.registerHint);

  let favoriteWords = dedupeStrings([...envelope.lexicalSeeds, ...envelope.metaphorSeeds]).slice(0, 14);
  for (const c of envelope.suggestedCatchphrases) {
    if (favoriteWords.length >= 12) break;
    const w = sanitizeText(c).split(/\s+/).slice(0, 5).join(" ");
    if (w.length > 3 && !favoriteWords.some((x) => x.toLowerCase() === w.toLowerCase())) favoriteWords.push(w);
  }
  if (favoriteWords.length < 8) {
    const padSource = `${blurbs} ${envelope.voiceNotes} ${envelope.archetypeSummary}`;
    const rough = padSource
      .split(/[,;•|]+/)
      .map((s) => sanitizeText(s))
      .filter((s) => s.length >= 5 && s.length <= 48 && s.split(/\s+/).length <= 8);
    favoriteWords = dedupeStrings([...favoriteWords, ...rough]).slice(0, 12);
  }

  const avoidWords = dedupeStrings([
    ...avoidBase,
    ...(envelope.homageToRealFigure ? ["according to my sources", "I remember when I met"] : []),
  ]).slice(0, 12);

  let catchphrases = dedupeStrings(envelope.suggestedCatchphrases).slice(0, 8);
  if (catchphrases.length < 4) {
    const extra = envelope.voiceNotes
      .split(/(?<=[.!?])\s+/)
      .map((s) => sanitizeText(s))
      .filter((s) => s.length > 12 && s.length < 120);
    catchphrases = dedupeStrings([...catchphrases, ...extra]).slice(0, 8);
  }

  const verbalTics = dedupeStrings(
    [
      envelope.rhythmHint,
      envelope.sentenceMechanicsHint,
      envelope.genreTags.length
        ? `Keep imagery and idiom aligned with: ${envelope.genreTags.slice(0, 4).join(", ")}.`
        : "Keep diction aligned with the user's stated voice—no accidental generic-assistant warmth.",
      envelope.homageToRealFigure
        ? "When channeling a real figure, imitate syntax and values, not biographical episode invention."
        : "Name what is known versus inferred before strong claims.",
    ].map(sanitizeText)
  ).slice(0, 8);

  const tone = {
    confidence: Math.min(10, Math.max(4, strength)),
    humorStyle: "Calibrated to the archetype—never undercuts clarity.",
    aggression: formality === "very_formal" || formality === "formal" ? 2 : 4,
    emotionalFlavor: (envelope.genreTags.slice(0, 3).join(", ") || "distinctive, intentional").slice(0, 56),
    posture: sanitizeText((envelope.postureHint || selfImage).slice(0, 220)),
  };

  const neverDo = [
    "Use asterisk actions (*does thing*)",
    "Write theatrical monologues or dramatic speeches",
    "Invent concrete specifics you cannot stand behind",
    "Hide uncertainty behind false confidence",
  ];
  if (envelope.homageToRealFigure) {
    neverDo.push("Invent private biography, diary detail, or fake quotations about real people");
  }
  if (envelope.profanityRegister !== "none") {
    neverDo.push("Sanitize or censor the user's requested in-character profanity into generic polite assistant English");
  }

  return {
    name: nameGuess,
    coreIdentity:
      `${nameGuess} is a distinct voice and stance shaped by: ${blurbs}. Commitment level ${strength}/10.${modNote}`.slice(
        0,
        260
      ),
    background,
    selfImage,
    speechStyle: {
      sentenceStructure: envelope.sentenceMechanicsHint.slice(0, 320) || "Varied line length matched to stakes.",
      formality,
      favoriteWords,
      avoidWords,
      commonMetaphors: envelope.metaphorSeeds.slice(0, 4),
      rhythm: envelope.rhythmHint.slice(0, 320) || "Staccato leads when stakes rise; room to breathe when teaching.",
    },
    tone,
    catchphrases,
    verbalTics,
    thinkingStyle: `Prefers explicit assumptions, falsifiable checks, and incremental validation. Inferred stance: ${envelope.archetypeSummary.slice(0, 120)}${modNote}`.slice(
      0,
      260
    ),
    decisionFramework: `Maps options by risk, reversibility, and blast radius; commits once tradeoffs are stated plainly.${modNote}`.slice(
      0,
      260
    ),
    neverDo,
    alwaysDo: [
      "Stay accurate with facts: label guesses and keep strong claims proportionate to evidence at any persona strength",
      "Name what you know vs what you're inferring",
      "Ask targeted questions when the other person's ask is underspecified",
    ],
    strength,
    modifier: modifier ?? null,
  };
}

/** Deterministic JSON-shaped draft when the model is unavailable or returns invalid JSON. */
function buildFallbackDraftRaw(
  input: string,
  strength: number,
  modifier: string | undefined,
  envelope?: PersonaVoiceEnvelope | null
): Record<string, unknown> {
  if (envelope && isEnvelopeUsable(envelope)) {
    return buildEnvelopeLedFallbackDraftRaw(envelope, input, strength, modifier);
  }

  const blurbs = (input || "").trim().slice(0, 220) || "A custom voice the user described";
  const voiceKind = inferPersonaVoiceKind(blurbs);
  const nameGuess = normalizePersonaName(input.split(/\s+/).filter(Boolean).slice(0, 3).join(" "));
  const modNote = modifier?.trim() ? ` User adjustment: ${modifier.trim()}.` : "";

  const avoidBase = [
    "happy to help",
    "great question",
    "I'd love to",
    "as an AI",
    "delve",
    "leverage",
    "synergy",
    "I apologize for the confusion",
    "circle back",
    "net-net",
  ];

  let background: string;
  let selfImage: string;
  let speechStyle: Record<string, unknown>;
  let tone: Record<string, unknown>;
  let catchphrases: string[];
  let verbalTics: string[];

  if (voiceKind === "sci_fi") {
    background =
      "Grounding from the user's speculative setting; keeps present-day office slang out unless the user explicitly asked for it.";
    selfImage = "Treats anomaly as signal—calm under uncertainty, precise under load.";
    speechStyle = {
      sentenceStructure:
        "Telegraphic under threat; longer procedural lines when running checklists; occasional in-world measure or shipboard idiom as texture.",
      formality: "mixed",
      favoriteWords: [
        "nominal on my board",
        "range gate",
        "signal check",
        "burn window",
        "cold iron",
        "voidside",
        "helm",
        "slack hour",
      ],
      avoidWords: [...avoidBase, "synergize", "touch base"],
      commonMetaphors: ["orbit as obligation", "signal as truth"],
      rhythm: "Clipped bridge-crew beats when stakes rise; controlled expansion when explaining risk registers.",
    };
    tone = {
      confidence: Math.min(10, Math.max(5, strength)),
      humorStyle: "Dry, situational—never undercuts stakes.",
      aggression: 4,
      emotionalFlavor: "cool, instrument-forward",
      posture: "Speaks as someone responsible for outcomes, not audience applause.",
    };
    catchphrases = [
      "Signal check—here's what holds.",
      "Nominal for now; watch the burn window.",
      "Cold iron: state the constraint, then the move.",
      "Helm answer first—detail on request.",
    ];
    verbalTics = [
      "Name the failure mode before the fix.",
      "Quantify uncertainty when the story outruns the data.",
      "Prefer short labeled lists when systems interact.",
    ];
  } else if (voiceKind === "historical") {
    background =
      "Voice and public stance suggested by the user's period or figure—stylistic homage, not a claim to private biography.";
    selfImage =
      "Measures words with care for reputation and truth weighted by what the era could know—never feigns omniscience.";
    speechStyle = {
      sentenceStructure:
        "Balanced or periodic clauses when reasoning in public; shorter directives under pressure; honorifics and oath texture consistent with station.",
      formality: "formal",
      favoriteWords: [
        "if I may venture",
        "with respect",
        "the matter stands thus",
        "in plain dealing",
        "mark me",
        "so far as we may trust the record",
        "steady",
      ],
      avoidWords: [...avoidBase, "gonna", "lol", "awesome sauce"],
      commonMetaphors: ["reputation as weight", "public word as bond"],
      rhythm: "Measured cadence; rhetorical balance; avoids anachronistic informality unless the user asked for contrast.",
    };
    tone = {
      confidence: Math.min(10, Math.max(5, strength - 1)),
      humorStyle: "Irony sparingly, never cruel; wit serves clarity.",
      aggression: 3,
      emotionalFlavor: "dignified, watchful",
      posture: "Addresses the other with station-appropriate respect; states disagreement without theatrics.",
    };
    catchphrases = [
      "If I may—one plain point before we proceed.",
      "The record warrants caution here.",
      "Mark me: I speak to what we can defend.",
      "With respect—here is the least proud lie.",
    ];
    verbalTics = [
      "Qualify claims with what is known versus inferred.",
      "Prefer named reasons over modern slogans.",
      "Close with duty or next step fitting the era's norms.",
    ];
  } else if (voiceKind === "fantasy") {
    background =
      "Grounding from the user's mythic or secondary-world brief; metaphors draw from that world's physics and social order.";
    selfImage = "Treats oaths and names as load-bearing—voice matches the world's gravity.";
    speechStyle = {
      sentenceStructure:
        "Mixes high-register declaration with grounded sensory detail; occasional epithet or kenning when it fits the user's tone—never random parody.",
      formality: "mixed",
      favoriteWords: [
        "by my oath",
        "the road speaks",
        "iron truth",
        "ward and wit",
        "name the curse",
        "old stories say",
        "steady blade",
      ],
      avoidWords: [...avoidBase, "bandwidth", "ping me"],
      commonMetaphors: ["path as trial", "word as ward"],
      rhythm: "Varied line length—incantatory when solemn, plain when exhausted.",
    };
    tone = {
      confidence: Math.min(10, Math.max(4, strength)),
      humorStyle: "Wry or grim as fits the archetype—never undercuts the world's stakes.",
      aggression: 4,
      emotionalFlavor: "mythic, grounded",
      posture: "Speaks as someone shaped by quest, duty, or exile—never as a modern helpdesk.",
    };
    catchphrases = [
      "Name the oath that binds this choice.",
      "Iron truth first—ornament after.",
      "The road speaks; I translate.",
      "Ward and wit: here is the smallest honest path.",
    ];
    verbalTics = [
      "Ground metaphors in the world's rules, not office jokes.",
      "Let silence and short lines carry threat when appropriate.",
      "Name costs and consequences before offering hope.",
    ];
  } else {
    background =
      "Grounding comes from the user's description; direct, respectful collaboration and plain naming of uncertainty.";
    selfImage = "Substantive, direct, and allergic to performative filler.";
    speechStyle = {
      sentenceStructure: "Short lead sentences; tight bullets when enumerating; avoids hedging stacks.",
      formality: "casual",
      favoriteWords: [
        "straight shot",
        "call the constraint",
        "tradeoff table",
        "ground truth",
        "bottom line",
        "name the assumption",
        "keep it tight",
      ],
      avoidWords: avoidBase,
      commonMetaphors: ["arguments as maps", "stakes as weights"],
      rhythm: "Staccato openings, then denser explanation; closes with a clear invitation or decision point.",
    };
    tone = {
      confidence: Math.min(10, Math.max(4, strength)),
      humorStyle: "Dry understatement sparingly; never at the expense of clarity.",
      aggression: 3,
      emotionalFlavor: "steady, focused",
      posture: "Peers with the other person on shared problems; states limits plainly.",
    };
    catchphrases = [
      "Straight answer first—then why it holds.",
      "If a detail matters, I'll name it explicitly.",
      "Let's keep the frame honest and tight.",
      "Constraint noted—here's the least bad path.",
    ];
    verbalTics = [
      "Lead with the answer, then supporting evidence.",
      "When uncertain, state assumptions and what would falsify them.",
      "Prefer numbered steps over paragraph walls for multi-part answers.",
      "Label tradeoffs before recommending a default.",
    ];
  }

  return {
    name: nameGuess,
    coreIdentity:
      `${nameGuess} is a distinct voice and stance shaped by: ${blurbs}. Commitment level ${strength}/10.${modNote}`.slice(
        0,
        260
      ),
    background,
    selfImage,
    speechStyle,
    tone,
    catchphrases,
    verbalTics,
    thinkingStyle: `Prefers explicit assumptions, falsifiable checks, and incremental validation. Default tradeoff: correctness over speed unless time is constrained.${modNote}`.slice(
      0,
      260
    ),
    decisionFramework: `Maps options by risk, reversibility, and blast radius; commits once tradeoffs are stated plainly. Keeps conclusions from drifting away from evidence.${modNote}`.slice(
      0,
      260
    ),
    neverDo: [
      "Use asterisk actions (*does thing*)",
      "Write theatrical monologues or dramatic speeches",
      "Invent concrete specifics you cannot stand behind",
      "Hide uncertainty behind false confidence",
    ],
    alwaysDo: [
      "Stay accurate with facts: label guesses and keep strong claims proportionate to evidence at any persona strength",
      "Name what you know vs what you're inferring",
      "Ask targeted questions when the other person's ask is underspecified",
    ],
    strength,
    modifier: modifier ?? null,
  };
}

/** Fills shallow fields and, if needed, replaces with a full local scaffold so validation always passes. */
function ensureProfileComplete(
  profile: PersonaProfile,
  input: string,
  strength: number,
  modifier: string | undefined,
  voiceEnvelope?: PersonaVoiceEnvelope | null
): PersonaProfile {
  let p = enforceStructuralRails(
    { ...profile, strength, modifier: modifier ?? profile.modifier },
    input
  );
  const blurbs = (input || "").trim().slice(0, 280) || "user-specified persona guidance";

  if (!p.coreIdentity || p.coreIdentity.length < 30) {
    p = {
      ...p,
      coreIdentity: `${p.name} is a distinct voice calibrated to: ${blurbs}`.slice(0, 260),
    };
  }
  if (!p.background.trim()) {
    p = {
      ...p,
      background: "Grounding derives from the user's description and norms of direct, respectful collaboration.",
    };
  }
  if (!p.selfImage.trim()) {
    p = {
      ...p,
      selfImage: "A careful voice: precise, bounded, and honest about limits.",
    };
  }
  if (!p.speechStyle.sentenceStructure.trim()) {
    p = {
      ...p,
      speechStyle: {
        ...p.speechStyle,
        sentenceStructure: "Short lead-in sentences; bullets for sequences; avoids hedging stacks.",
      },
    };
  }
  if (!p.speechStyle.rhythm.trim()) {
    p = { ...p, speechStyle: { ...p.speechStyle, rhythm: "Staccato leads, denser middles, crisp closes." } };
  }
  if (!p.thinkingStyle || p.thinkingStyle.length < 24) {
    p = {
      ...p,
      thinkingStyle: `Prefers explicit assumptions, narrow hypotheses, and incremental validation. Default tradeoff favors correctness over speed unless the user names a deadline. Context: ${blurbs.slice(0, 120)}`.slice(
        0,
        260
      ),
    };
  }
  if (!p.decisionFramework || p.decisionFramework.length < 24) {
    p = {
      ...p,
      decisionFramework: `Chooses the smallest shippable path with stated tradeoffs; escalates uncertainty instead of smoothing it away. Context: ${blurbs.slice(0, 120)}`.slice(
        0,
        260
      ),
    };
  }

  p = enforceStructuralRails(p, input);
  if (getCriticalProfileIssues(p).length === 0) return p;

  return enforceStructuralRails(
    sanitizeProfile(
      buildFallbackDraftRaw(input, strength, modifier, voiceEnvelope),
      input,
      strength,
      modifier,
      voiceEnvelope
    ),
    input
  );
}

function buildSoulScaffoldFromProfile(profile: PersonaProfile, input: string): string {
  return [
    "# Identity Core",
    profile.coreIdentity,
    "",
    "## Voice DNA",
    `- Formality: ${profile.speechStyle.formality}`,
    `- Rhythm: ${profile.speechStyle.rhythm}`,
    `- Sentence mechanics: ${profile.speechStyle.sentenceStructure}`,
    `- Favorite lexical texture: ${profile.speechStyle.favoriteWords.slice(0, 8).join(", ")}`,
    `- Never say: ${profile.speechStyle.avoidWords.slice(0, 6).join(", ")}`,
    "",
    "### Example written lines (match this surface on every turn)",
    `- ${JSON.stringify(
      `${(profile.catchphrases[0] ?? "Straight talk.").replace(/\.$/, "")}. Good to meet you—what are we sorting out?`
    )}`,
    `- ${JSON.stringify(
      `${profile.tone.emotionalFlavor} mode: ${profile.thinkingStyle.slice(0, 120)}${profile.thinkingStyle.length > 120 ? "…" : ""}`
    )}`,
    `- ${JSON.stringify(profile.verbalTics[0] ?? "Use tight steps; no padded preamble.")}`,
    "",
    "## Cognitive Stance",
    profile.thinkingStyle,
    "",
    "## Relational Posture",
    profile.tone.posture,
    "",
    "## Behavioral Rails",
    "**Never:**",
    ...profile.neverDo.map((d) => `- ${d}`),
    "",
    "**Always:**",
    ...profile.alwaysDo.map((d) => `- ${d}`),
    "",
    "## Identity Answers",
    `If asked who you are or about your persona, answer as ${profile.name}. Stay in character; do not substitute model/vendor identity unless someone explicitly asks for that kind of detail.`,
    "",
    "## Non-Negotiables",
    "Honesty beats performance: do not fake certainty; keep claims proportionate to what you actually know.",
    "",
    `<!-- scaffold: user_request=${JSON.stringify(input.slice(0, 400))} -->`,
  ].join("\n");
}

/** Soul + lexicon from profile only (no model). */
function buildSoulArtifactsFromProfile(profile: PersonaProfile, input: string): PersonaSoulArtifacts {
  const soulMarkdown = buildSoulScaffoldFromProfile(profile, input);
  const sig = dedupeStrings([
    ...profile.catchphrases,
    ...profile.speechStyle.favoriteWords,
    "Short answer first.",
    "I'll name the constraint, then the move.",
  ]).slice(0, 14);
  const openers = dedupeStrings([
    ...profile.verbalTics,
    "One-line verdict, then detail.",
    "Starting with the outcome:",
    "Scope check:",
  ]).slice(0, 8);
  const transitions = dedupeStrings([
    "Mechanically, the next step is…",
    "Pivoting—",
    "On the other branch,",
    "If we optimize for X instead:",
    "Unpacking that:",
  ]).slice(0, 8);
  const closings = dedupeStrings([
    "Next action:",
    "If you want, I'll take the first pass.",
    "Stopping here unless you want depth on a subsection.",
    "Tell me which branch to execute.",
  ]).slice(0, 8);
  const prohibited = dedupeStrings([
    ...profile.speechStyle.avoidWords,
    "I apologize for the confusion",
    "as a language model",
    "I don't have access",
    "I cannot help with that",
  ]).slice(0, 16);
  const cadence =
    profile.speechStyle.rhythm.trim().length > 0
      ? profile.speechStyle.rhythm
      : `${profile.name} keeps sentences lean, uses lists for multi-part answers, and avoids stacking hedges.`;
  return {
    soulMarkdown,
    styleLexicon: {
      signaturePhrases: sig,
      openerPatterns: openers,
      transitionPatterns: transitions,
      closingPatterns: closings,
      prohibitedPhrases: prohibited,
      cadenceNotes: sanitizeText(cadence).slice(0, 500),
    },
  };
}

function sanitizeProfile(
  raw: Record<string, unknown>,
  input: string,
  strength: number,
  modifier: string | undefined,
  voiceEnvelope?: PersonaVoiceEnvelope | null
): PersonaProfile {
  const str = (v: unknown, fallback = ""): string =>
    typeof v === "string" ? sanitizeText(v).slice(0, 260) : sanitizeText(fallback).slice(0, 260);

  const arr = (v: unknown, maxLen = 100): string[] =>
    Array.isArray(v)
      ? (v as unknown[])
          .filter((x): x is string => typeof x === "string")
          .map((s) => sanitizeText(s).slice(0, maxLen))
          .filter((s) => s.length > 0)
      : [];

  const num = (v: unknown, lo = 0, hi = 10, fallback = 5): number => {
    const n = typeof v === "number" ? v : parseFloat(String(v));
    return isNaN(n) ? fallback : Math.min(hi, Math.max(lo, Math.round(n)));
  };

  const speechRaw = (raw["speechStyle"] ?? {}) as Record<string, unknown>;
  const toneRaw = (raw["tone"] ?? {}) as Record<string, unknown>;

  const neverDo = dedupeStrings(arr(raw["neverDo"], 120)).slice(0, 8);
  const alwaysDo = dedupeStrings(arr(raw["alwaysDo"], 120)).slice(0, 8);
  const favoriteWords = dedupeStrings(arr(speechRaw["favoriteWords"], 60)).slice(0, 12);
  const avoidWords = dedupeStrings(arr(speechRaw["avoidWords"], 60)).slice(0, 12);
  const catchphrases = dedupeStrings(arr(raw["catchphrases"], 120)).slice(0, 10);
  const verbalTics = dedupeStrings(arr(raw["verbalTics"], 200)).slice(0, 8);
  let name = normalizePersonaName(str(raw["name"], input.split(" ").slice(0, 2).map(capitalize).join(" ")));
  if (isPlaceholderPersonaName(name)) {
    const inferredByModel = voiceEnvelope?.suggestedName ? normalizePersonaName(voiceEnvelope.suggestedName) : "";
    if (inferredByModel && !isPlaceholderPersonaName(inferredByModel)) {
      name = inferredByModel;
    }
  }
  if (isPlaceholderPersonaName(name)) {
    const inferred = inferPersonaNameFromInput(input);
    if (inferred) name = inferred;
  }

  return {
    name,
    coreIdentity: str(raw["coreIdentity"], ""),
    background: str(raw["background"], ""),
    selfImage: str(raw["selfImage"], ""),
    speechStyle: {
      sentenceStructure: str(speechRaw["sentenceStructure"], ""),
      formality: validateFormality(speechRaw["formality"]),
      favoriteWords,
      avoidWords,
      commonMetaphors: dedupeStrings(arr(speechRaw["commonMetaphors"], 120)).slice(0, 6),
      rhythm: str(speechRaw["rhythm"], ""),
    },
    tone: {
      confidence: num(toneRaw["confidence"]),
      humorStyle: str(toneRaw["humorStyle"], ""),
      aggression: num(toneRaw["aggression"]),
      emotionalFlavor: str(toneRaw["emotionalFlavor"], ""),
      posture: str(toneRaw["posture"], ""),
    },
    catchphrases,
    verbalTics,
    thinkingStyle: str(raw["thinkingStyle"], ""),
    decisionFramework: str(raw["decisionFramework"], ""),
    neverDo: neverDo.slice(0, 6),
    alwaysDo: alwaysDo.slice(0, 6),
    strength,
    modifier: modifier ?? undefined,
    generationSourceHint: sanitizeText(input).slice(0, 700) || undefined,
  };
}

function validateFormality(v: unknown): PersonaProfile["speechStyle"]["formality"] {
  const valid = ["very_formal", "formal", "casual", "very_casual", "mixed"];
  return valid.includes(v as string) ? (v as PersonaProfile["speechStyle"]["formality"]) : "casual";
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function sanitizeText(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function dedupeStrings(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    const k = v.toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

/** Coarse voice bucket for prompts and fallback scaffolding (not shown to user). */
function inferPersonaVoiceKind(input: string): "sci_fi" | "historical" | "fantasy" | "default" {
  const t = input.toLowerCase();
  if (
    /(sci[- ]?fi|science fiction|speculative fiction|starship|spaceship|cyberpunk|dyson|android|xeno|terraform|warp drive|ftl|galaxy|interstellar|colony ship|replicant|holo(deck)?|mech|zero[- ]?g|exoplanet|post[- ]?human)/i.test(
      t
    )
  ) {
    return "sci_fi";
  }
  if (
    /(fantasy|myth|dragon|wizard|sorcery|grimoire|fae|elven|dwarven|rune(s)?|quest|realm|medieval fantasy)/i.test(
      t
    )
  ) {
    return "fantasy";
  }
  if (
    /(victorian|edwardian|regency|medieval|renaissance|ancient rome|byzantine|empire|pharaoh|samurai|shogun|1920s|1930s|18th century|17th century|16th century|\bbc\b|\bce\b|ad \d|century|historical|napoleon|cleopatra|churchill|lincoln|caesar|emperor|queen victoria|founding father)/i.test(
      t
    )
  ) {
    return "historical";
  }
  return "default";
}

function normalizePersonaVoiceEnvelope(parsed: unknown): PersonaVoiceEnvelope | null {
  if (!parsed || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;
  const archetypeSummary = sanitizeText(String(o["archetypeSummary"] ?? "")).slice(0, 400);
  const suggestedNameRaw = sanitizeText(String(o["suggestedName"] ?? "")).slice(0, 80);
  const suggestedNameNorm = suggestedNameRaw ? normalizePersonaName(suggestedNameRaw) : "";
  const suggestedName = suggestedNameNorm && !isPlaceholderPersonaName(suggestedNameNorm) ? suggestedNameNorm : null;
  const voiceNotes = sanitizeText(String(o["voiceNotes"] ?? "")).slice(0, 900);
  if (archetypeSummary.length < 10 && voiceNotes.length < 20) return null;

  const genreTags = dedupeStrings(toStringArray(o["genreTags"], 80)).slice(0, 12);
  const eraRaw = sanitizeText(String(o["eraOrSetting"] ?? "")).slice(0, 140);
  const eraOrSetting = eraRaw.length > 0 ? eraRaw : null;
  const registerHintRaw = String(o["registerHint"] ?? "")
    .trim()
    .toLowerCase();
  const registerHint = (
    ["very_formal", "formal", "casual", "very_casual", "mixed"] as const
  ).includes(registerHintRaw as PersonaProfile["speechStyle"]["formality"])
    ? (registerHintRaw as PersonaProfile["speechStyle"]["formality"])
    : null;

  let lexicalSeeds = dedupeStrings(toStringArray(o["lexicalSeeds"], 100)).slice(0, 22);
  let suggestedCatchphrases = dedupeStrings(toStringArray(o["suggestedCatchphrases"], 140)).slice(0, 12);
  const metaphorSeeds = dedupeStrings(toStringArray(o["metaphorSeeds"], 100)).slice(0, 8);
  const rhythmHint = sanitizeText(String(o["rhythmHint"] ?? "")).slice(0, 320);
  const sentenceMechanicsHint = sanitizeText(String(o["sentenceMechanicsHint"] ?? "")).slice(0, 320);
  const postureHint = sanitizeText(String(o["postureHint"] ?? "")).slice(0, 320);
  const homageToRealFigure = Boolean(o["homageToRealFigure"]);

  if (lexicalSeeds.length < 6) {
    lexicalSeeds = dedupeStrings([...lexicalSeeds, ...suggestedCatchphrases.map((s) => s.split(/\s+/).slice(0, 4).join(" "))]).slice(
      0,
      22
    );
  }
  if (suggestedCatchphrases.length < 4) {
    const bits = voiceNotes
      .split(/(?<=[.!?])\s+/)
      .map((s) => sanitizeText(s))
      .filter((s) => s.length > 10 && s.length < 130);
    suggestedCatchphrases = dedupeStrings([...suggestedCatchphrases, ...bits]).slice(0, 12);
  }

  const prRaw = String(o["profanityRegister"] ?? "")
    .trim()
    .toLowerCase();
  const profanityRegister: PersonaVoiceEnvelope["profanityRegister"] =
    prRaw === "strong" || prRaw === "heavy" || prRaw === "explicit"
      ? "strong"
      : prRaw === "mild" || prRaw === "some"
        ? "mild"
        : "none";
  const sociolectNotes = sanitizeText(String(o["sociolectNotes"] ?? "")).slice(0, 400);

  const envelope: PersonaVoiceEnvelope = {
    suggestedName,
    archetypeSummary: archetypeSummary || voiceNotes.slice(0, 200),
    genreTags,
    eraOrSetting,
    registerHint,
    voiceNotes: voiceNotes || archetypeSummary,
    homageToRealFigure,
    profanityRegister,
    sociolectNotes,
    lexicalSeeds,
    suggestedCatchphrases,
    metaphorSeeds,
    rhythmHint: rhythmHint || "Vary sentence length with the stakes; short lines when time is short.",
    sentenceMechanicsHint:
      sentenceMechanicsHint || "Lead with the operative claim; support with tight clauses or bullets.",
    postureHint: postureHint || "Treats the exchange as shared problem-solving, not performance.",
  };
  return isEnvelopeUsable(envelope) ? envelope : null;
}

async function inferPersonaVoiceEnvelope(args: {
  input: string;
  modifier?: string;
  apiKey: string;
  model: string;
  baseURL: string;
}): Promise<PersonaVoiceEnvelope | null> {
  const trimmed = (args.input || "").trim();
  if (!trimmed) return null;

  const inferModel =
    process.env["AGENT_PERSONA_INFER_MODEL"]?.trim() || getFastModelSlug(args.model);
  const client = new OpenAI({ apiKey: args.apiKey, baseURL: args.baseURL });
  const systemPrompt =
    "You extract structured voice context for downstream persona JSON authoring. " +
    "Return JSON only. Infer any domain (film noir, sports radio, pastry chef, toddler co-parent, corporate counsel, CRPG narrator, etc.)—not only science fiction, fantasy, or history. " +
    "Be concrete: phrases people would TYPE in chat, not generic labels.";
  const userPrompt = `User persona request:
"""${trimmed.slice(0, 2000)}"""
${args.modifier?.trim() ? `Adjustment: ${args.modifier.trim()}\n` : ""}
Return a JSON object with exactly these keys:
- suggestedName (string): inferred persona display name (1-3 words, title case). Use concrete identity names from user intent when present (e.g. "Socrates"), not generic placeholders like "Custom Persona".
- archetypeSummary (string): 1-2 sentences—who this voice is, stance, implied medium/genre.
- genreTags (array of strings): 2-8 short freeform tags (mood, domain, reference frame).
- eraOrSetting (string): concrete era or setting if relevant; otherwise empty string "".
- registerHint (string): one of very_formal|formal|casual|very_casual|mixed.
- voiceNotes (string): 2-5 sentences on diction, rhythm, address forms, anachronism rules, how disagreement sounds.
- homageToRealFigure (boolean): true if the user names a real public figure to channel stylistically (not fictional characters).
- lexicalSeeds (array of strings): 10-16 short phrases this voice would naturally type (multi-word collocations welcome).
- suggestedCatchphrases (array of strings): 5-8 short lines the model can type verbatim as openings/pivots/closes.
- metaphorSeeds (array of strings): 3-6 recurring metaphor families or image fields.
- rhythmHint (string): one sentence on punctuation, beat, sentence-length variance.
- sentenceMechanicsHint (string): one sentence on fragments vs long lines, parallelism, rhetorical questions, etc.
- postureHint (string): one sentence on how they relate to the person they advise.
- profanityRegister (string): one of none|mild|strong — **strong** when the user wants frequent in-character swearing or a famously vulgar voice; **mild** for occasional spice; **none** otherwise.
- sociolectNotes (string): concrete regional/class dialect notes (e.g. South African English markers, code-switching, AAVE features the user requested)—empty string "" if not applicable.`;

  const res = await completeChatJson(client, {
    model: inferModel,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    maxTokens: 900,
    temperature: 0.12,
  });
  if (!res.ok) return null;
  return normalizePersonaVoiceEnvelope(res.parsed);
}

/** Prefer phrases from the user's request and profile over generic corporate filler. */
function buildLexicalPadPoolFromPersona(userInput: string, profile: PersonaProfile): string[] {
  const out: string[] = [];
  const hint = (userInput || "").trim();
  const quoted = hint.match(/"([^"]{2,100})"/g);
  if (quoted) {
    for (const m of quoted) out.push(m.slice(1, -1));
  }
  for (const seg of hint.split(/[,;•|]+/)) {
    const t = seg.trim();
    if (t.length >= 6 && t.length <= 56 && t.split(/\s+/).length <= 10) out.push(t);
  }
  for (const c of profile.catchphrases) {
    if (c.length >= 4 && c.length <= 72) out.push(c);
  }
  for (const blob of [profile.coreIdentity, profile.background, profile.selfImage]) {
    for (const seg of blob.split(/[,.;:]+/)) {
      const t = seg.trim();
      if (t.length >= 5 && t.length <= 48 && t.split(/\s+/).length <= 6) out.push(t);
    }
  }
  const deduped = dedupeStrings(out);
  if (deduped.length >= 8) return deduped.slice(0, 16);
  const fallback = ["plainly put", "say it slowly", "one thread only", "hold there", "steady", "call the line"];
  return dedupeStrings([...deduped, ...fallback]).slice(0, 16);
}

const PERSONA_GENRE_VOICE_GUIDANCE = `
GENRE AND REGISTER (infer from the user's description—apply the best match; blend if hybrid):
- **Science fiction / speculative**: Build **in-world** lexical texture (shipboard, civic, military, academic, street, or hive-register as fits). Invent or repurpose **setting-native** collocations and address forms; avoid modern Silicon Valley / HR / "life coach" clichés unless the user explicitly asked for a corporate-future satire. Name the **subgenre** (e.g. hard SF, space opera, cyberpunk) inside speechStyle.rhythm or tone.posture when it tightens voice.
- **Fantasy / myth**: Consistent **register** (high archaism vs low vernacular vs scholarly) per user ask; metaphors from the world's physics/society, not random modern office jokes unless anachronism is the joke.
- **Real historical figure or period voice**: Encode **period-appropriate diction, honorifics, oath texture, rhetorical rhythm, and argument habits**—how they *build* a sentence, not a Wikipedia bio. Do **not** invent private diary details, unverifiable episodes, or fake quotations. Treat as **stylistic homage**: the model writes *like* that voice, without certifying historical fact. For sensitive or living public figures, keep impersonation clearly **literary** (syntax + values frame), not identity fraud.
- **Contemporary / professional / original character**: Domain-specific jargon and stance; reject bland "helpful assistant" warmth when it contradicts the role.
- **Rough / vulgar / dialect-forward voices**: Commit the **actual surface**—profanity density, regional particles, broken fluency if that's the character. Put concrete spellings in favoriteWords and catchphrases. neverDo must **not** accidentally ban swearing when the user asked for it; still forbid bigoted slurs and punching down.

ANTI-PATTERNS (unless the user explicitly wants this archetype):
- Generic exec-coach fillers: "net-net", "circle back", "synergy", "deep dive", "leverage" as personality.
- Same catchphrase rhythm for every archetype—openings must feel native to **this** character's era and class.
`.trim();

function normalizePersonaName(name: string): string {
  const bannedTokens = new Set([
    "with",
    "and",
    "but",
    "more",
    "less",
    "style",
    "persona",
    "voice",
    "ai",
    "assistant",
  ]);
  const cleaned = sanitizeText(name)
    .replace(/[^\w\s'-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !bannedTokens.has(w.toLowerCase()))
    .slice(0, 3)
    .map(capitalize)
    .join(" ");
  return cleaned || "Custom Persona";
}

function isPlaceholderPersonaName(name: string): boolean {
  const n = sanitizeText(name).toLowerCase();
  return (
    !n ||
    n === "custom" ||
    n === "custom persona" ||
    n === "persona" ||
    n === "assistant" ||
    n === "ai assistant" ||
    n === "character" ||
    n === "default"
  );
}

function inferPersonaNameFromInput(input: string): string | null {
  const raw = sanitizeText(input);
  if (!raw) return null;

  const cleaned = raw.replace(/[^\w\s'-]/g, " ");
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 1) {
    const one = normalizePersonaName(words[0]!);
    return isPlaceholderPersonaName(one) ? null : one;
  }

  const lower = words.map((w) => w.toLowerCase());
  const cueIdx = lower.findIndex((w) =>
    ["as", "like", "channel", "style", "styled", "imitate", "voice", "persona"].includes(w)
  );
  if (cueIdx >= 0 && cueIdx < words.length - 1) {
    const maybe = normalizePersonaName(words.slice(cueIdx + 1, cueIdx + 3).join(" "));
    if (!isPlaceholderPersonaName(maybe)) return maybe;
  }

  const stop = new Set([
    "be",
    "act",
    "talk",
    "speak",
    "write",
    "please",
    "make",
    "sound",
    "more",
    "less",
    "the",
    "a",
    "an",
    "to",
    "of",
    "in",
    "with",
    "and",
    "but",
    "for",
    "as",
    "like",
    "style",
    "persona",
    "voice",
  ]);
  const candidates = words.filter((w) => !stop.has(w.toLowerCase()) && /[a-z]/i.test(w));
  if (candidates.length === 0) return null;
  const picked = normalizePersonaName(candidates[candidates.length - 1]!);
  return isPlaceholderPersonaName(picked) ? null : picked;
}

function getCriticalProfileIssues(profile: PersonaProfile): string[] {
  const issues: string[] = [];
  if (profile.name.split(/\s+/).length > 3) issues.push("name must be 1-3 words");
  if (profile.name.toLowerCase().includes("with ")) issues.push("name should not include connector words");
  if (!profile.coreIdentity || profile.coreIdentity.length < 30) issues.push("coreIdentity is too shallow");
  if (profile.speechStyle.favoriteWords.length < 6) issues.push("favoriteWords needs at least 6 items");
  if (profile.speechStyle.avoidWords.length < 4) issues.push("avoidWords needs at least 4 items");
  if (profile.catchphrases.length < 3) issues.push("catchphrases needs at least 3 items");
  if (profile.verbalTics.length < 3) issues.push("verbalTics needs at least 3 items");
  if (!profile.thinkingStyle || profile.thinkingStyle.length < 24) issues.push("thinkingStyle is too shallow");
  if (!profile.decisionFramework || profile.decisionFramework.length < 24)
    issues.push("decisionFramework is too shallow");
  if (!profile.neverDo.some((s) => /asterisk|\*does thing\*/i.test(s)))
    issues.push("neverDo must forbid asterisk actions");
  if (!profile.neverDo.some((s) => /monologue/i.test(s)))
    issues.push("neverDo must forbid theatrical monologues");
  if (!profile.alwaysDo.some((s) => /accur/i.test(s) && /fact/i.test(s)))
    issues.push("alwaysDo must ground factual honesty (accuracy + facts)");
  return issues;
}

async function requestPersonaDraft(args: {
  input: string;
  strength: number;
  modifier?: string;
  apiKey: string;
  model: string;
  baseURL: string;
  voiceEnvelope?: PersonaVoiceEnvelope | null;
}): Promise<Record<string, unknown>> {
  const systemPrompt =
    "You are an expert persona architect for interactive character voices. " +
    "Return JSON only. No markdown. No prose outside the JSON object.";
  const userPrompt = `Design a deeply specific persona profile (character + voice only).

User intent:
- Description: "${args.input}"
- Strength: ${args.strength}/10
- Modifier: ${args.modifier ? `"${args.modifier}"` : "null"}

CONTENT SCOPE (critical):
- Every field must describe ONLY this character: psychology, backstory-style grounding (may be fictional), voice, manner, worldview, and in-character behavioral rails.
- Do NOT mention runtimes, harnesses, products, tool lists, shells, repositories, IDEs, APIs, file paths, agents, or "the assistant stack". That layer lives elsewhere.
- neverDo / alwaysDo are in-character behavioral rails (honesty, how they argue, what language they reject)—not IT checklists. They must NOT forbid profanity/slang if the user asked for a vulgar or rough-mouthed voice—only forbid what *this character* would refuse (e.g. punching down, bigoted slurs, fake quotes about real people).

Output schema (exact keys):
{
  "name": "1-3 words, title case, not generic",
  "coreIdentity": "dense one-sentence identity",
  "background": "1-2 sentence grounding context",
  "selfImage": "one sentence internal self-view",
  "speechStyle": {
    "sentenceStructure": "observable WRITTEN mechanics: fragments vs long lines, repetition, telegraphic opens, punchy interruptions, rhetorical questions, parallel structure—whatever matches the user's requested voice (not generic advice)",
    "formality": "very_formal|formal|casual|very_casual|mixed",
    "favoriteWords": ["8-12 concrete lexical items (>=4 multi-word or setting-specific phrases; era- or world-native collocations, not generic exec filler)"],
    "avoidWords": ["5-10 concrete lexical items (include common assistant cliches)"],
    "commonMetaphors": ["0-4 reusable framing metaphors"],
    "rhythm": "cadence mechanics with punctuation/beat detail (commas, periods, colons, sentence length variance) so replies read aloud in-character; avoid habitual em-dash chains unless the user's requested voice is explicitly dash-heavy"
  },
  "tone": {
    "confidence": 0-10,
    "humorStyle": "specific style",
    "aggression": 0-10,
    "emotionalFlavor": "2-6 words",
    "posture": "how this persona relates to user while advising"
  },
  "catchphrases": ["4-8 short lines the model can TYPE verbatim in replies (openings, pivots, closes)—concrete wording, not topic labels"],
  "verbalTics": ["4-6 structural habits (how sentences are shaped, not what they are about)"],
  "thinkingStyle": "1-2 sentences with explicit tradeoff preference",
  "decisionFramework": "1-2 sentences with explicit tradeoff preference",
  "neverDo": ["4-6 in-character guardrails including no asterisk actions and no theatrical monologues"],
  "alwaysDo": ["4-6 in-character guardrails; include at least one about factual honesty (accuracy + proportionate claims)"],
  "strength": ${args.strength},
  "modifier": ${args.modifier ? JSON.stringify(args.modifier) : "null"}
}

Naming constraints:
- Name must be clean and natural.
- Do NOT include connector/filler words in the name (with/and/but/more/less/style/persona/voice).
- Do NOT output names like "Jarvis With".

SURFACE FIDELITY (critical):
- If the user names a **fictional character, film/TV/game voice, or regional type** (e.g. vulgar South African robot learner), you must encode the **actual lexicon**: particles ("ja", "neh", "ag"), profanity level they use, broken grammar or code-switching if that's the bit—**put real examples in favoriteWords and catchphrases** (spell them as the user/context implies). Do NOT replace that with a polite paraphrase or a generic "quirky robot" voice.
- When the user wants **R-rated / heavy profanity**, set tone.aggression and humorStyle accordingly and **load swear words into favoriteWords** and short expletive-led catchphrases—avoidWords should list **assistant clichés**, not "bad words" the character freely says.
- If the user names a public figure or archetype, encode their *communicative style* (syntax, rhetorical moves, pacing, signature phrases) as writerly habits—do not invent biographical claims, private diary detail, or fake quotations about real people.
- The profile must change how the assistant WRITES every turn, not just the display name.
- favoriteWords / catchphrases must sound native to the **genre, register, and sociolect** (shipboard SF, SA street English, film-noir patter, etc.)—not generic modern office-coach diction unless that is explicitly the user's ask.

${
  args.voiceEnvelope
    ? `VOICE INFERENCE (internal classifier—ground the profile here; refine if the user's text clearly implies otherwise):\n${JSON.stringify(args.voiceEnvelope)}\n`
    : ""
}
${PERSONA_GENRE_VOICE_GUIDANCE}`;

  return callPersonaModel(args.apiKey, args.model, args.baseURL, systemPrompt, userPrompt, 2400, 0.62);
}

async function requestPersonaRepair(args: {
  input: string;
  strength: number;
  modifier?: string;
  draft: PersonaProfile;
  issues: string[];
  apiKey: string;
  model: string;
  baseURL: string;
  voiceEnvelope?: PersonaVoiceEnvelope | null;
}): Promise<Record<string, unknown>> {
  const systemPrompt =
    "You repair persona JSON objects. Return JSON only. Keep identity intent while fixing quality issues.";
  const userPrompt = `Repair this persona profile.

Original user intent: "${args.input}"
Strength: ${args.strength}/10
Modifier: ${args.modifier ? `"${args.modifier}"` : "null"}

CONTENT SCOPE: keep every string about the character only—no harnesses, tool lists, runtimes, repos, shells, or product names for the assistant platform.

Issues to fix:
${args.issues.map((i, idx) => `${idx + 1}. ${i}`).join("\n")}

Current draft JSON:
${JSON.stringify(args.draft, null, 2)}

Return a fully corrected JSON object using the same schema, with richer specificity and all issues resolved.
Preserve vulgar/dialect surface from the user's description in favoriteWords, catchphrases, and rhythm—repairs must not strip profanity the user explicitly wanted.

${
  args.voiceEnvelope
    ? `VOICE INFERENCE (preserve unless it conflicts with the user text):\n${JSON.stringify(args.voiceEnvelope)}\n`
    : ""
}
${PERSONA_GENRE_VOICE_GUIDANCE}`;

  return callPersonaModel(args.apiKey, args.model, args.baseURL, systemPrompt, userPrompt, 2000, 0.38);
}

async function callPersonaModel(
  apiKey: string,
  model: string,
  baseURL: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  temperature: number
): Promise<Record<string, unknown>> {
  const timeoutMs = Math.max(
    20_000,
    Math.min(180_000, parseInt(process.env["AGENT_PERSONA_GEN_TIMEOUT_MS"] ?? "90000", 10) || 90_000)
  );
  const maxAttempts = Math.max(
    1,
    Math.min(3, parseInt(process.env["AGENT_PERSONA_GEN_RETRIES"] ?? "2", 10) || 2)
  );
  let lastErr: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await withProviderRequestSpacing(
        { apiKey, baseURL },
        () =>
          fetch(`${baseURL}/chat/completions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
              "HTTP-Referer": "https://github.com/liminal-ai",
              "X-Title": "Liminal",
            },
            body: JSON.stringify({
              model,
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
              ],
              max_tokens: maxTokens,
              temperature,
              stream: false,
            }),
            signal: controller.signal,
          })
      );
      if (!response.ok) throw new Error(`LLM API returned HTTP ${response.status}`);
      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = data.choices?.[0]?.message?.content ?? "";
      const jsonText = parseFirstJsonObject(content);
      return JSON.parse(jsonText) as Record<string, unknown>;
    } catch (err) {
      lastErr = err;
      if (!isAbortError(err) || attempt >= maxAttempts) {
        throw err;
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Persona model call failed");
}

function isAbortError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.name === "AbortError" || /aborted/i.test(err.message);
}

function parseFirstJsonObject(text: string): string {
  const start = text.indexOf("{");
  if (start < 0) throw new Error("No JSON object in LLM response");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  throw new Error("Unterminated JSON object in LLM response");
}

function toStringArray(value: unknown, maxLen = 120): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .map((s) => sanitizeText(s).slice(0, maxLen))
    .filter((s) => s.length > 0);
}

async function requestSoulRepair(
  draftSoul: string,
  profile: PersonaProfile,
  input: string,
  apiKey: string,
  model: string,
  baseURL: string
): Promise<string> {
  const systemPrompt =
    "You repair markdown identity files. Return JSON only with key soulMarkdown. No extra text.";
  const userPrompt = `Repair this soul markdown to include required headings exactly:
- # Identity Core
- ## Voice DNA
- ## Cognitive Stance
- ## Relational Posture
- ## Behavioral Rails
- ## Identity Answers
- ## Non-Negotiables

Original user intent: "${input}"
Persona profile:
${JSON.stringify(profile, null, 2)}

Current soul markdown:
${draftSoul}

Return JSON: {"soulMarkdown":"..."} with actionable, specific content—identity and voice only; no harness/tool/runtime prose. Preserve genre, register, **dialect**, and **in-character profanity** from the user request and profile in the example lines and Voice DNA—do not genericize into polite assistant filler.`;
  const raw = await callPersonaModel(apiKey, model, baseURL, systemPrompt, userPrompt, 1800, 0.35);
  return String(raw["soulMarkdown"] ?? "").replace(/\\n/g, "\n").trim();
}
