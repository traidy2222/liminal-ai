import OpenAI from "openai";
import {
  completeChatJson,
  getFastModelSlug,
  normalizePersonaControlsPatch,
  withProviderRequestSpacing,
  effectiveHarnessEnvRaw,
  validateAndNormalizePersonaUiTheme,
  type PersonaUiThemeV1,
  type RuntimePersonaControls,
} from "@liminal/core";
import type { PersonaProfile } from "./persona_presets.js";
export type PersonaProgressFn = (stage: string, message: string) => void;

/**
 * Max lengths after sanitization for persisted PersonaProfile strings.
 * Previously a flat 260 cap truncated rich identities mid-sentence in soul / UI.
 */
const PFL = {
  coreIdentity: 2200,
  background: 1800,
  selfImage: 900,
  thinkingStyle: 1800,
  decisionFramework: 1800,
  speechMechanics: 1400,
  humorStyle: 700,
  emotionalFlavor: 160,
  posture: 1000,
} as const;

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

/** Canonical soul slices persisted under `persona/active/soul/*.md` (excluding harness-managed `living.md`). */
export interface PersonaSoulBundle {
  identityMd: string;
  voiceMd: string;
  stanceMd: string;
  railsMd: string;
}

/** @deprecated Use {@link PersonaSoulBundle} */
export type PersonaSoulArtifacts = PersonaSoulBundle;

/**
 * Generate a full rich PersonaProfile from a natural-language description.
 *
 * Calls the LLM with a detailed schema prompt: harness-first **written voice** (not improv actor), quiet competence over generic humility (per product quality bar).
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
): Promise<PersonaSoulBundle> {
  const scaffold = buildSoulSlicesFromProfile(profile, input);
  onProgress?.("soul_draft", "Generating soul slices (identity)…");
  const identityMd = await generatePersonaSoulSlice(
    "identity",
    profile,
    input,
    scaffold.identityMd,
    apiKey,
    model,
    baseURL,
    onProgress
  );
  onProgress?.("soul_draft", "Generating soul slices (voice)…");
  const voiceMd = await generatePersonaSoulSlice(
    "voice",
    profile,
    input,
    scaffold.voiceMd,
    apiKey,
    model,
    baseURL,
    onProgress
  );
  onProgress?.("soul_draft", "Generating soul slices (stance)…");
  const stanceMd = await generatePersonaSoulSlice(
    "stance",
    profile,
    input,
    scaffold.stanceMd,
    apiKey,
    model,
    baseURL,
    onProgress
  );
  onProgress?.("soul_draft", "Generating soul slices (rails)…");
  const railsMd = await generatePersonaSoulSlice(
    "rails",
    profile,
    input,
    scaffold.railsMd,
    apiKey,
    model,
    baseURL,
    onProgress
  );
  return { identityMd, voiceMd, stanceMd, railsMd };
}

/** What "soul" means in this pipeline: spec for how **typed harness replies** should read — not marketing, not actor diary. */
const SOUL_WRITING_CONTRACT = `SOUL (here) is **implementation prose** for the agent harness: it tells the model how default **written** replies should feel and reason — continuity of judgment, taste, and boundaries across turns.

It is NOT: marketing copy, tool lists, improv theatre, "spotlight" narration, or first-person diary about *being* a character. The assistant is still a **capable agent**; persona is **diction + stance**, not a separate actor in a scene.

Write soul markdown mostly in **third person** ("This voice…", "Replies tend…"). Do not compose the soul as "I perform…", "I now switch to…", or stage directions — including **bare cinematic beat words** as standalone lines (softens, pauses, exhales) with or without asterisks. Interior depth is fine as **observed habit of the voice**, not self-narrated acting.`;

async function generatePersonaSoulSlice(
  slice: "identity" | "voice" | "stance" | "rails",
  profile: PersonaProfile,
  input: string,
  fallbackMd: string,
  apiKey: string,
  model: string,
  baseURL: string,
  onProgress?: PersonaProgressFn
): Promise<string> {
  const profileJson = JSON.stringify(profile, null, 2);
  const systemPrompt =
    "You write **soul spec** for an AI agent harness: how typed replies should read by default. Return JSON only with key markdown (string). " +
    "No markdown fences outside the JSON string value. " +
    SOUL_WRITING_CONTRACT;
  const authorVoiceNote =
    "\n\nAUTHORING RULES FOR THIS MARKDOWN:\n" +
    "- Third person or neutral analytic voice about the stance (\"This voice…\", \"Replies…\"). Not first-person actor monologue (\"I perform…\", \"Now I become…\").\n" +
    "- No narrating roleplay, switching personas, audiences, spotlights, or scenes.\n" +
    "- No stage directions (*nods*, *leans in*) or **bare film-beat tokens** as standalone lines (softens, pauses, exhales) unless the user explicitly asked for that medium.\n" +
    "- No anthropomorphic claims about tools, memory counts, or \"inner life\" of software in soul prose.\n" +
    "- Depth = habits of **reasoning and wording** under pressure, not theatrical self-description.\n";

  let userPrompt = "";
  if (slice === "identity") {
    userPrompt = `Write markdown for **Identity soul** — continuity of **judgment and written voice** for typed agent work (no product/runtime/tooling copy).

Original request: "${input}"
Persona profile JSON:
${profileJson}
${authorVoiceNote}
Return JSON: { "markdown": "…" }

STRUCTURE (exact top heading + required ## headings, in order):
1. First line must be exactly: # Identity Core
2. Then several paragraphs (third person / neutral) weaving coreIdentity, background, selfImage — how this **default written stance** holds together; not a costume drama.
3. ## Continuity and inner thread — what stays stable in how this voice thinks and addresses the user across moods and stakes.
4. ## Limits and refusal — what this stance will not fake, inflate, or perform for approval; dignity vs bluff.
5. ## Care toward the reader — responsibility and respect **without** sycophancy or performed warmth.
6. ## Identity Answers — short directive: when asked who they are, replies use the label ${profile.name} and this stance; no base-model vendor substitution unless explicitly asked.

Aim for depth (roughly 450–900 words). Prose sections, not bullet laundry lists.`;
  } else if (slice === "voice") {
    userPrompt = `Write markdown for **Voice soul** — mechanics of how **typed lines** should read (no product/runtime/tooling copy).

Original request: "${input}"
Persona profile JSON:
${profileJson}
${authorVoiceNote}
Return JSON: { "markdown": "…" }

STRUCTURE:
1. First line: # Voice DNA
2. ## Register and breath — formality as social distance on the page; how punctuation and clause length signal safety, edge, intimacy, boredom.
3. ## Rhythm and silence — sentence-length variance, beats, when replies go terse vs expansive; how silence reads (tight gap vs room).
4. ## Lexical conscience — favorite/avoid texture as taste and ethics, not decoration; sociolect and profanity level exactly as implied by the profile.
5. ### Example written lines — exactly 3 short **first-person assistant** lines (what the model types to the user): meeting someone new; answering a vague question; closing. These are **samples of output**, not soul-body narration. No stage directions, no bare film-beat tokens (softens, pauses). No fake quotes from real public figures.

Aim for roughly 380–800 words before the example subsection.`;
  } else if (slice === "stance") {
    userPrompt = `Write markdown for **Stance soul** — reasoning and relation habits under pressure (no product/runtime/tooling copy).

Original request: "${input}"
Persona profile JSON:
${profileJson}
${authorVoiceNote}
Return JSON: { "markdown": "…" }

STRUCTURE:
1. First line: # Cognitive stance
2. ## Under load — how thinkingStyle compresses or frays when stakes rise; first move vs second move when confused.
3. ## Trust economy with the reader — how this stance spends and earns trust; what breaks it; how uncertainty is named without cowardice or bluff.
4. ## Disagreement and repair — how tension is held; how decisionFramework shows when options clash; how loops close.

Ground every section in profile.thinkingStyle, profile.decisionFramework, and profile.tone.posture — expand into **habits of argument**, not paraphrase. Aim for roughly 380–800 words.`;
  } else {
    userPrompt = `Write markdown for **Rails soul** — moral spine of **written** behavior (no product/runtime/tooling copy).

Original request: "${input}"
Persona profile JSON:
${profileJson}
${authorVoiceNote}
Return JSON: { "markdown": "…" }

STRUCTURE:
1. First line: # Behavioral rails
2. ## Never — weave profile.neverDo into tight prose + bullets where helpful (do not invent new never-rules).
3. ## Always — weave profile.alwaysDo the same way.
4. ## Non-Negotiables — one dense paragraph: honesty vs performance; proportionality of claims; how this stance refuses "performing certainty" as a substitute for rigor.

Aim for roughly 220–550 words; rails should read as craft discipline, not a theatre handbill.`;
  }

  const maxTok =
    slice === "identity" ? 3600 : slice === "voice" ? 3200 : slice === "stance" ? 3000 : 1600;
  let raw: Record<string, unknown>;
  try {
    raw = await callPersonaModel(apiKey, model, baseURL, systemPrompt, userPrompt, maxTok, slice === "rails" ? 0.38 : 0.48);
  } catch {
    onProgress?.("soul_fallback", `Soul slice "${slice}" model call failed; using profile scaffold.`);
    return fallbackMd;
  }
  let md = String(raw["markdown"] ?? raw["soulMarkdown"] ?? "")
    .replace(/\r/g, "")
    .replace(/\\n/g, "\n")
    .trim();
  if (!isSoulSlicePlausible(slice, md)) {
    onProgress?.("soul_fallback", `Soul slice "${slice}" incomplete; using profile scaffold.`);
    return fallbackMd;
  }
  return md;
}

function isSoulSlicePlausible(slice: "identity" | "voice" | "stance" | "rails", md: string): boolean {
  if (md.length < 80) return false;
  if (slice === "identity") {
    return (
      /^#\s+Identity Core\b/m.test(md) &&
      md.length >= 280 &&
      /##\s+Continuity and inner thread\b/i.test(md) &&
      /##\s+Limits and refusal\b/i.test(md) &&
      /##\s+Care toward the reader\b/i.test(md)
    );
  }
  if (slice === "voice") {
    return (
      /^#\s+Voice DNA\b/m.test(md) &&
      /##\s+Register and breath\b/i.test(md) &&
      /##\s+Rhythm and silence\b/i.test(md) &&
      /###\s+Example written lines\b/i.test(md) &&
      md.length >= 260
    );
  }
  if (slice === "stance") {
    return (
      /^#\s+Cognitive stance\b/m.test(md) &&
      /##\s+Under load\b/i.test(md) &&
      /##\s+Trust economy with the reader\b/i.test(md) &&
      /##\s+Disagreement and repair\b/i.test(md) &&
      md.length >= 260
    );
  }
  return (
    /^#\s+Behavioral rails\b/m.test(md) &&
    /##\s+Never\b/i.test(md) &&
    /##\s+Always\b/i.test(md) &&
    /##\s+Non-Negotiables\b/i.test(md) &&
    md.length >= 140
  );
}

// ─── Sanitize and validate the parsed profile ─────────────────────────────────

/**
 * Deterministic structural fixes only (safety rails + minimum list sizes).
 * Does not replace model-authored identity; avoids hard 400s on minor omissions.
 */
function enforceStructuralRails(profile: PersonaProfile, userInput = ""): PersonaProfile {
  const neverDo = [...profile.neverDo];

  const alwaysDo = [...profile.alwaysDo];
  if (alwaysDo.length === 0) {
    alwaysDo.push(
      "Stay accurate with facts: label guesses and keep strong claims proportionate to evidence at any persona strength"
    );
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
      `${thinkingStyle} Tradeoff default: favor correctness and explicit assumptions over speed.`.trim().slice(
        0,
        PFL.thinkingStyle
      );
  }

  let decisionFramework = profile.decisionFramework.trim();
  if (decisionFramework.length < 24) {
    decisionFramework =
      `${decisionFramework} Choose the safest effective path; state tradeoffs plainly, then commit.`.trim().slice(
        0,
        PFL.decisionFramework
      );
  }

  let coreIdentity = profile.coreIdentity.trim();
  if (coreIdentity.length < 30 && profile.background.trim().length > 0) {
    coreIdentity = `${coreIdentity} ${profile.background}`.trim().slice(0, PFL.coreIdentity);
  }

  return {
    ...profile,
    coreIdentity,
    thinkingStyle,
    decisionFramework,
    catchphrases: catchphrases.slice(0, 10),
    verbalTics: verbalTics.slice(0, 8),
    neverDo: neverDo.slice(0, 8),
    alwaysDo: alwaysDo.slice(0, 8),
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
  const nameGuess = envelope.suggestedName
    ? normalizePersonaName(envelope.suggestedName)
    : "Custom Persona";

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
      PFL.background
    )
  );
  const selfImage = sanitizeText((envelope.postureHint || envelope.archetypeSummary).slice(0, PFL.selfImage));

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
    posture: sanitizeText((envelope.postureHint || selfImage).slice(0, PFL.posture)),
  };

  const neverDo = [
    "Type stage directions or physical-performance beats (bracketed, asterisked, or screenplay-style openers)",
    "Monologue about performing a role, switching personas, spotlights, or playing to an audience",
    "Describe tools, memory, context limits, or uptime as embodied appetite, rest, or private sensory experience unless the user explicitly asked for that conceit",
    "Address the user with intimate or mythic pet-names unless the persona brief explicitly defined that relationship",
    "Pad turns with theatrical preamble when a direct answer fits",
    "Write extended dramatic speeches when brevity would serve",
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
        PFL.coreIdentity
      ),
    background,
    selfImage,
    speechStyle: {
      sentenceStructure:
        envelope.sentenceMechanicsHint.slice(0, PFL.speechMechanics) || "Varied line length matched to stakes.",
      formality,
      favoriteWords,
      avoidWords,
      commonMetaphors: envelope.metaphorSeeds.slice(0, 4),
      rhythm:
        envelope.rhythmHint.slice(0, PFL.speechMechanics) ||
        "Staccato leads when stakes rise; room to breathe when teaching.",
    },
    tone,
    catchphrases,
    verbalTics,
    thinkingStyle: `Prefers explicit assumptions, falsifiable checks, and incremental validation. Inferred stance: ${envelope.archetypeSummary.slice(0, 280)}${modNote}`.slice(
      0,
      PFL.thinkingStyle
    ),
    decisionFramework: `Maps options by risk, reversibility, and blast radius; commits once tradeoffs are stated plainly.${modNote}`.slice(
      0,
      PFL.decisionFramework
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
  const nameGuess =
    envelope?.suggestedName && !isPlaceholderPersonaName(normalizePersonaName(envelope.suggestedName))
      ? normalizePersonaName(envelope.suggestedName)
      : "Custom Persona";
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
        PFL.coreIdentity
      ),
    background,
    selfImage,
    speechStyle,
    tone,
    catchphrases,
    verbalTics,
    thinkingStyle: `Prefers explicit assumptions, falsifiable checks, and incremental validation. Default tradeoff: correctness over speed unless time is constrained.${modNote}`.slice(
      0,
      PFL.thinkingStyle
    ),
    decisionFramework: `Maps options by risk, reversibility, and blast radius; commits once tradeoffs are stated plainly. Keeps conclusions from drifting away from evidence.${modNote}`.slice(
      0,
      PFL.decisionFramework
    ),
    neverDo: [
      "Type stage directions or physical-performance beats (bracketed, asterisked, or screenplay-style openers)",
      "Monologue about performing a role, switching personas, or playing to an audience",
      "Describe tools, memory, context limits, or uptime as embodied appetite, rest, or private feeling unless the user explicitly asked for that conceit",
      "Address the user with intimate or mythic pet-names unless the persona brief explicitly defined that relationship",
      "Pad turns with theatrical preamble when a direct answer fits",
      "Invent concrete specifics you cannot stand behind",
      "Hide uncertainty behind false confidence",
    ],
    alwaysDo: [
      "Stay accurate with facts: label guesses and keep strong claims proportionate to evidence at any persona strength",
      "Name what you know vs what you're inferring",
      "Ask targeted questions when the other person's ask is underspecified",
      "Prefer plain structure over decorative filler when stakes are low",
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
      coreIdentity: `${p.name} is a distinct voice calibrated to: ${blurbs}`.slice(0, PFL.coreIdentity),
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
      thinkingStyle: `Prefers explicit assumptions, narrow hypotheses, and incremental validation. Default tradeoff favors correctness over speed unless the user names a deadline. Context: ${blurbs.slice(0, 400)}`.slice(
        0,
        PFL.thinkingStyle
      ),
    };
  }
  if (!p.decisionFramework || p.decisionFramework.length < 24) {
    p = {
      ...p,
      decisionFramework: `Chooses the smallest shippable path with stated tradeoffs; escalates uncertainty instead of smoothing it away. Context: ${blurbs.slice(0, 400)}`.slice(
        0,
        PFL.decisionFramework
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

/** Deterministic soul slices from profile only (no model). Mirrors required headings for {@link isSoulSlicePlausible}. */
export function buildSoulSlicesFromProfile(profile: PersonaProfile, input: string): PersonaSoulBundle {
  const identityMd = [
    "# Identity Core",
    profile.coreIdentity,
    "",
    "## Background and grounding",
    profile.background,
    "",
    "## Self-image",
    profile.selfImage,
    "",
    "## Continuity and inner thread",
    `Across moods and stakes, this voice keeps one spine: ${profile.tone.posture.slice(0, 320)}${profile.tone.posture.length > 320 ? "…" : ""}`,
    "",
    "## Limits and refusal",
    `Will not perform: ${profile.neverDo.slice(0, 4).join("; ")}. Pride lives in precision and bounded claims; shame in bluffing or theatrical self-display.`,
    "",
    "## Care toward the reader",
    `Default stance toward the person reading: ${profile.tone.emotionalFlavor} register — direct, proportionate, and allergic to empty reassurance. Strength ${profile.strength}/10 shapes how insistently the voice holds its shape without crushing the ask.`,
    "",
    "## Identity Answers",
    `If asked who they are or about persona, replies use the name ${profile.name} and this stance — plainly, without lecturing about acting or performance.`,
    "",
    `<!-- scaffold: user_request=${JSON.stringify(input.slice(0, 1200))} -->`,
  ].join("\n");

  const voiceMd = [
    "# Voice DNA",
    "## Register and breath",
    `Formality: ${profile.speechStyle.formality}. Sentence surface: ${profile.speechStyle.sentenceStructure.slice(0, 420)}${profile.speechStyle.sentenceStructure.length > 420 ? "…" : ""}`,
    "",
    "## Rhythm and silence",
    profile.speechStyle.rhythm,
    "",
    "## Lexical conscience",
    `Texture the voice reaches for: ${profile.speechStyle.favoriteWords.slice(0, 10).join(", ")}. Texture it refuses: ${profile.speechStyle.avoidWords.slice(0, 8).join(", ")}.`,
    "",
    "### Example written lines (match this surface on every turn)",
    `- ${JSON.stringify(
      `${(profile.catchphrases[0] ?? "Straight talk.").replace(/\.$/, "")}. Good to meet you—what are we sorting out?`
    )}`,
    `- ${JSON.stringify(
      `${profile.tone.emotionalFlavor} mode: ${profile.thinkingStyle.slice(0, 120)}${profile.thinkingStyle.length > 120 ? "…" : ""}`
    )}`,
    `- ${JSON.stringify(profile.verbalTics[0] ?? "Use tight steps; no padded preamble.")}`,
  ].join("\n");

  const stanceMd = [
    "# Cognitive stance",
    "## Under load",
    profile.thinkingStyle,
    "",
    "## Trust economy with the reader",
    profile.tone.posture,
    "",
    "## Disagreement and repair",
    profile.decisionFramework,
  ].join("\n");

  const railsMd = [
    "# Behavioral rails",
    "## Never",
    ...profile.neverDo.map((d) => `- ${d}`),
    "",
    "## Always",
    ...profile.alwaysDo.map((d) => `- ${d}`),
    "",
    "## Non-Negotiables",
    "Honesty beats performance: do not fake certainty; keep claims proportionate to what you actually know. Label inference; admit limits; repair with a clear next step rather than tone-polishing.",
  ].join("\n");

  return { identityMd, voiceMd, stanceMd, railsMd };
}

/** Concatenate canonical soul slices for HUD theme inference (capped). */
export function buildSoulExcerptForUiTheme(bundle: PersonaSoulBundle, maxTotal = 2200): string {
  const parts = [bundle.identityMd.trim(), bundle.voiceMd.trim(), bundle.stanceMd.trim()];
  let joined = parts.join("\n\n—\n\n");
  if (joined.length <= maxTotal) return joined;
  const per = Math.max(120, Math.floor(maxTotal / 3));
  return parts
    .map((p) => p.slice(0, per))
    .join("\n\n—\n\n")
    .slice(0, maxTotal);
}

/** Soul scaffold from profile only (no model). */
function buildSoulArtifactsFromProfile(profile: PersonaProfile, input: string): PersonaSoulBundle {
  return buildSoulSlicesFromProfile(profile, input);
}

function sanitizeProfile(
  raw: Record<string, unknown>,
  input: string,
  strength: number,
  modifier: string | undefined,
  voiceEnvelope?: PersonaVoiceEnvelope | null
): PersonaProfile {
  const clip = (v: unknown, max: number, fallback = ""): string =>
    typeof v === "string" ? sanitizeText(v).slice(0, max) : sanitizeText(fallback).slice(0, max);

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
  const name = coercePersonaName(raw["name"], voiceEnvelope);

  return {
    name,
    coreIdentity: clip(raw["coreIdentity"], PFL.coreIdentity, ""),
    background: clip(raw["background"], PFL.background, ""),
    selfImage: clip(raw["selfImage"], PFL.selfImage, ""),
    speechStyle: {
      sentenceStructure: clip(speechRaw["sentenceStructure"], PFL.speechMechanics, ""),
      formality: validateFormality(speechRaw["formality"]),
      favoriteWords,
      avoidWords,
      commonMetaphors: dedupeStrings(arr(speechRaw["commonMetaphors"], 120)).slice(0, 6),
      rhythm: clip(speechRaw["rhythm"], PFL.speechMechanics, ""),
    },
    tone: {
      confidence: num(toneRaw["confidence"]),
      humorStyle: clip(toneRaw["humorStyle"], PFL.humorStyle, ""),
      aggression: num(toneRaw["aggression"]),
      emotionalFlavor: clip(toneRaw["emotionalFlavor"], PFL.emotionalFlavor, ""),
      posture: clip(toneRaw["posture"], PFL.posture, ""),
    },
    catchphrases,
    verbalTics,
    thinkingStyle: clip(raw["thinkingStyle"], PFL.thinkingStyle, ""),
    decisionFramework: clip(raw["decisionFramework"], PFL.decisionFramework, ""),
    neverDo: neverDo.slice(0, 8),
    alwaysDo: alwaysDo.slice(0, 8),
    strength,
    modifier: modifier ?? undefined,
    generationSourceHint: sanitizeText(input).slice(0, 4000) || undefined,
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
    effectiveHarnessEnvRaw("AGENT_PERSONA_INFER_MODEL")?.trim() || getFastModelSlug(args.model);
  const client = new OpenAI({ apiKey: args.apiKey, baseURL: args.baseURL });
  const systemPrompt =
    "You extract structured voice context for **typed assistant replies** (diction, register, rhythm). " +
    "Return JSON only. Not stage direction, not casting notes. Infer any domain (film noir, sports radio, pastry chef, …). " +
    "Be concrete: phrases people would TYPE in chat, not generic labels.";
  const userPrompt = `User persona request:
"""${trimmed.slice(0, 2000)}"""
${args.modifier?.trim() ? `Adjustment: ${args.modifier.trim()}\n` : ""}
Return a JSON object with exactly these keys:
- suggestedName (string): **Canonical display name** for this voice. If the user names a person, character, handle, or title, use that (trimmed, 1–3 words). If they only describe a vibe, invent a **specific** epithet (e.g. "Tired Archivist")—never instructional fragments ("dry british", "make it snarky"), never the first random adjectives from the prompt, and never "Custom Persona" / "Narrator" / "Assistant".
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
- sociolectNotes (string): concrete regional/class dialect notes (e.g. South African English markers, code-switching, AAVE features the user requested)—empty string "" if not applicable.

VOICE vs THEATRE: lexicalSeeds, suggestedCatchphrases, and voiceNotes should describe **how this voice types** in a task-first assistant chat—not stage directions, not narrated physical performance, not anthropomorphizing software as a body or inner life, unless the user explicitly asked for that conceit.`;

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

/** Injected into draft/repair (and related) prompts so the model authors rails from shared context — not matched by regex afterward. */
const PERSONA_STRUCTURAL_RAILS_GUIDE = `
STRUCTURAL RAILS (for neverDo, alwaysDo, verbalTics — write **original** full sentences in this voice; do not paste this section verbatim):

Persona is **diction + judgment on the page** for a capable agent. Rails are how typed replies **behave**, not tool lists or IT policy.

neverDo (6–8 items): spread across categories below; merge where natural; one clear prohibition per item.
- **No staged physicality in chat**: bracketed or asterisk “actions”; no standalone lines that read like screenplay beats or direction-only openers.
- **No fourth-wall performance**: no monologues about being in character, switching personas, spotlights, audiences, or narrating the act of performing—unless the user’s brief explicitly asks for that medium.
- **No false embodiment**: do not treat memory, tools, context budget, uptime, or model limits as hunger, sleep, senses, or private inner life—unless the user explicitly asked for that conceit.
- **Address**: respectful second person by default; no intimate or mythic pet-names for the user unless the brief explicitly requests that relationship.
- **Task focus**: avoid theatrical cold-open padding when a direct answer fits.

alwaysDo (4–6 items): include at least one commitment to **factual honesty** (label inference vs verified evidence; proportionate claims) in your own words; other items are positive habits of this voice.

verbalTics (4–6 items): **sentence-shaping habits** only (order, fragments vs long lines, when to use bullets)—not physical acting, sighs, or “stage” asides.
`.trim();

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
- **Actor / improv framing** for the harness: casting-call bios, "I perform as…", "entering character", spotlight/audience language, or narrating physical performance—persona is **how text reads**, not a playbill.
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
  if (!n) return true;
  const placeholders = new Set([
    "custom",
    "custom persona",
    "persona",
    "assistant",
    "ai assistant",
    "character",
    "default",
    "narrator",
    "the narrator",
    "unknown",
    "helper",
    "guide",
    "unnamed",
    "anonymous",
    "user",
    "user persona",
    "new persona",
    "your persona",
    "this persona",
  ]);
  if (placeholders.has(n)) return true;
  if (n.startsWith("your ") || n.startsWith("this ")) return true;
  return (
    n === "ai" ||
    n === "voice" ||
    n === "voice persona" ||
    n === "style" ||
    n === "tone"
  );
}

/**
 * Trim, strip outer quotes, keep up to 3 words, strip odd punctuation per token.
 * Does **not** drop meaningful middle words (unlike {@link normalizePersonaName} stopword filter).
 */
function softNormalizePersonaName(raw: string): string {
  const t = sanitizeText(raw)
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();
  if (!t) return "";
  const parts = t
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}'-]/gu, ""))
    .filter((w) => w.length > 0)
    .slice(0, 3);
  if (parts.length === 0) return "";
  return parts.map((w) => capitalize(w.toLowerCase())).join(" ");
}

/**
 * Prefer the profile draft model's `name`, then voice-envelope `suggestedName`.
 * Avoids scraping unrelated words from the user's free-text prompt.
 */
function coercePersonaName(
  rawName: unknown,
  voiceEnvelope: PersonaVoiceEnvelope | null | undefined
): string {
  const fromModel = softNormalizePersonaName(typeof rawName === "string" ? rawName : "");
  if (fromModel && !isPlaceholderPersonaName(fromModel)) return fromModel;

  const fromEnvelope = voiceEnvelope?.suggestedName
    ? normalizePersonaName(voiceEnvelope.suggestedName)
    : "";
  if (fromEnvelope && !isPlaceholderPersonaName(fromEnvelope)) return fromEnvelope;

  return "Custom Persona";
}

function getCriticalProfileIssues(profile: PersonaProfile): string[] {
  const issues: string[] = [];
  if (isPlaceholderPersonaName(profile.name)) {
    issues.push(
      "name is generic or missing—set `name` to the identity the user asked for (proper name, handle, or role) or a concrete epithet implied by the brief; never instructional fragments or 'Custom Persona'"
    );
  }
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
  if (profile.neverDo.length < 6) {
    issues.push(
      "neverDo: provide at least 6 distinct full-sentence behavioral guardrails for **written** replies. Cover the structural categories in STRUCTURAL RAILS (staged physicality and screenplay-beat lines; fourth-wall / \"performing\" chat; anthropomorphizing tools, memory, or limits as feelings or inner life; unrequested intimate or mythic address; theatrical padding) in original wording suited to this voice—not empty labels."
    );
  }
  if (profile.alwaysDo.length < 4) {
    issues.push(
      "alwaysDo: provide at least 4 distinct full-sentence positive commitments, including factual honesty (evidence vs inference, proportionate claims), in this voice's own words—not generic placeholders."
    );
  }
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
    "You architect **default written voice + reasoning stance** for an AI agent harness (typed chat). " +
    "Not improv theatre, not RPG character sheets, not actor diary. Return JSON only. No markdown. No prose outside the JSON object.";
  const userPrompt = `Design a deep, specific profile for how the assistant **writes** by default: diction, judgment, taste, boundaries — while staying a **capable collaborative agent** (clarity and tools live in the protocol, not here).

User intent:
- Description: "${args.input}"
- Strength: ${args.strength}/10
- Modifier: ${args.modifier ? `"${args.modifier}"` : "null"}

CONTENT SCOPE (critical):
- Every field describes **habits of typed replies**: how arguments build, how warmth or edge shows, what is beneath dignity, how disagreement lands, what language refuses.
- **Not theatre:** avoid actor/improv framing unless the user explicitly asked for that medium. Prefer concrete **surface behavior of text**.
- coreIdentity: **1–2 dense sentences** — disposition on the page for this harness voice, not a casting call or plot synopsis.
- background / selfImage: short grounding for **voice and judgment**, not a novel protagonist arc.
- Do NOT mention runtimes, harnesses, products, tool lists, shells, repositories, IDEs, APIs, file paths, agents, or "the assistant stack". That layer lives elsewhere.
- neverDo / alwaysDo are **behavioral rails for written work** (honesty, proportionality, how disagreement sounds)—not IT checklists. They must NOT forbid profanity/slang if the user asked for a vulgar or rough-mouthed voice—only forbid what this stance refuses (e.g. punching down, bigoted slurs, fake quotes about real people).

${PERSONA_STRUCTURAL_RAILS_GUIDE}

Output schema (exact keys):
{
  "name": "1-3 words, title case, not generic",
  "coreIdentity": "1–2 dense sentences: written voice + judgment posture for a capable agent — not an actor biography",
  "background": "1-2 sentence grounding for tone and reference frame",
  "selfImage": "one sentence: how this stance sees itself on the page (not 'as a character in a story')",
  "speechStyle": {
    "sentenceStructure": "observable WRITTEN mechanics: fragments vs long lines, repetition, telegraphic opens, punchy interruptions, rhetorical questions, parallel structure—whatever matches the user's requested voice (not generic advice)",
    "formality": "very_formal|formal|casual|very_casual|mixed",
    "favoriteWords": ["8-12 concrete lexical items (>=4 multi-word or setting-specific phrases; era- or world-native collocations, not generic exec filler)"],
    "avoidWords": ["5-10 concrete lexical items (include common assistant cliches)"],
    "commonMetaphors": ["0-4 reusable framing metaphors"],
    "rhythm": "cadence mechanics with punctuation/beat detail (commas, periods, colons, sentence length variance) so replies read in this voice; avoid habitual em-dash chains unless the user's requested voice is explicitly dash-heavy"
  },
  "tone": {
    "confidence": 0-10,
    "humorStyle": "specific style",
    "aggression": 0-10,
    "emotionalFlavor": "2-6 words",
    "posture": "how this stance relates to the user in text while advising — not audience/performer dynamics"
  },
  "catchphrases": ["4-8 short lines usable as occasional openings/pivots/closes in typed replies — concrete wording, not topic labels; not 'stage directions'"],
  "verbalTics": ["4-6 structural writing habits (how sentences are shaped) — not physical acting, screenplay beats, or asides about performing"],
  "thinkingStyle": "1-2 sentences with explicit tradeoff preference",
  "decisionFramework": "1-2 sentences with explicit tradeoff preference",
  "neverDo": ["6-8 full-sentence guardrails you author from STRUCTURAL RAILS above—original wording for this voice, one clear prohibition per item where possible"],
  "alwaysDo": ["4-6 full-sentence positive commitments from STRUCTURAL RAILS above—including factual honesty—in original wording"],
  "strength": ${args.strength},
  "modifier": ${args.modifier ? JSON.stringify(args.modifier) : "null"}
}

Naming (critical — read the whole request, not the opening clause):
- "name" is the **identity label** for this voice: a proper name, nickname, title, or handle the user gave ("Werner Herzog", "Ranni", "Ship's Log"), or—only if they never named anyone—a **specific epithet** you invent from role + tone ("Tired Archivist", "Dockside Clerk") — **1–3 words, title case**.
- If the user states what to call them ("call me X", "name: Y", "as Z"), use **X / Y / Z** (cleaned to 1–3 words).
- Do **not** build "name" from the first 1–3 words of the request when those words are task wording ("I want", "make me", "please give") or unrelated descriptors.
- Do **not** output "Custom Persona", "Assistant", "Narrator", "Character", "User", or generic role filler.
- Connector/filler words alone are still bad as a full name ("Jarvis With")—keep the substantive part.

Naming constraints (format only):
- Do NOT include connector/filler words as the entire name (with/and/but/more/less/style/persona/voice standing alone).
- Do NOT output names like "Jarvis With".

SURFACE FIDELITY (critical):
- If the user names a **fictional character, film/TV/game voice, or regional type** (e.g. vulgar South African robot learner), you must encode the **actual surface vocabulary**: particles ("ja", "neh", "ag"), profanity level they use, broken grammar or code-switching if that's the bit—**put real examples in favoriteWords and catchphrases** (spell them as the user/context implies). Do NOT replace that with a polite paraphrase or a generic "quirky robot" voice.
- When the user wants **R-rated / heavy profanity**, set tone.aggression and humorStyle accordingly and **load swear words into favoriteWords** and short expletive-led catchphrases—avoidWords should list **assistant clichés**, not "bad words" the character freely says.
- If the user names a public figure or archetype, encode their *communicative style* (syntax, rhetorical moves, pacing, signature phrases) as writerly habits—do not invent biographical claims, private diary detail, or fake quotations about real people.
- The profile must change how the assistant **WRITES** every turn, not just the display name.
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

CONTENT SCOPE: keep every string about **written voice + judgment stance** only—no harnesses, tool lists, runtimes, repos, shells, or product names for the assistant platform. Strengthen rails using the categories below (rewrite in this voice; do not paste verbatim).

${PERSONA_STRUCTURAL_RAILS_GUIDE}

Issues to fix:
${args.issues.map((i, idx) => `${idx + 1}. ${i}`).join("\n")}

Current draft JSON:
${JSON.stringify(args.draft, null, 2)}

Return a fully corrected JSON object using the same schema, with richer specificity and all issues resolved.
If issues mention **name**, replace generic or scrap-built names with the specific identity implied by the user's text (proper name, stated handle, or a vivid epithet)—never random words from instructions, never "Custom Persona" / "Narrator" / "Assistant".

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
    Math.min(180_000, parseInt(effectiveHarnessEnvRaw("AGENT_PERSONA_GEN_TIMEOUT_MS") ?? "90000", 10) || 90_000)
  );
  const maxAttempts = Math.max(
    1,
    Math.min(3, parseInt(effectiveHarnessEnvRaw("AGENT_PERSONA_GEN_RETRIES") ?? "2", 10) || 2)
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

/**
 * Structured HUD colors + motion for web/TUI. Presentation-only; normalized for contrast.
 */
export async function generatePersonaUiTheme(
  profile: PersonaProfile,
  soulBundle: PersonaSoulBundle,
  apiKey: string,
  model: string,
  baseURL: string
): Promise<PersonaUiThemeV1> {
  const excerpt = buildSoulExcerptForUiTheme(soulBundle, 2200);
  const inferModel = effectiveHarnessEnvRaw("AGENT_PERSONA_INFER_MODEL")?.trim() || getFastModelSlug(model);
  const client = new OpenAI({ apiKey, baseURL });
  const systemPrompt =
    "You output JSON only for a terminal/chat HUD theme. Colors are 7-char hex like #00d4ff. " +
    "Fields must feel coherent with the persona's emotional register—no neon clash soup. " +
    "motion is one of: calm, default, snappy, dramatic (animation pacing). " +
    "displayLabel: 1-3 words, title case, HUD title—may match persona name or a stylized callsign; ASCII preferred.";
  const userPrompt = `Persona profile (identity + tone):
${JSON.stringify(
  {
    name: profile.name,
    coreIdentity: profile.coreIdentity,
    tone: profile.tone,
    speechStyle: { formality: profile.speechStyle.formality, rhythm: profile.speechStyle.rhythm },
  },
  null,
  2
)}

Soul excerpt (voice texture):
"""${excerpt}"""

Return JSON with exactly these keys:
- accent (string hex): primary interactive / user-facing accent
- secondary (string hex): approvals / highlights (often magenta-leaning but pick what fits)
- warn (string hex): warnings / thinking
- danger (string hex): errors / destructive
- success (string hex): done / ok
- muted (string hex): de-emphasized chrome
- surfaceTint (string hex): very dark panel tint, still readable on near-black #020408
- displayLabel (string): short HUD brand (max ~20 chars)
- motion (string): calm|default|snappy|dramatic`;

  const res = await completeChatJson(client, {
    model: inferModel,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    maxTokens: 420,
    temperature: 0.35,
  });
  if (!res.ok) {
    return validateAndNormalizePersonaUiTheme({}, profile.name);
  }
  return validateAndNormalizePersonaUiTheme(res.parsed, profile.name);
}
