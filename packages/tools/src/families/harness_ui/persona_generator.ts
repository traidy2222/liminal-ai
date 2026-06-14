import OpenAI from "openai";
import {
  completeChatJson,
  getFastModelSlug,
  normalizePersonaControlsPatch,
  withProviderRequestSpacing,
  effectiveHarnessEnvRaw,
  validateAndNormalizePersonaUiTheme,
  repairPersonaUi,
  derivePersonaShellHeuristics,
  deriveDeterministicPersonaPalette,
  buildOpenRouterAttributionHeaders,
  sanitizePersonaUiCopy,
  DEFAULT_PERSONA_UI_COPY,
  type PersonaUiThemeV2,
  type PersonaUiCopy,
  type RuntimePersonaControls,
} from "@liminal/core";
import type { PersonaArtifactId } from "@liminal/core/persona-bootstrap-progress";
import type { PersonaProfile } from "./persona_presets.js";
import { buildHarnessCapabilityDomains } from "../../shared/harness_runtime_prompt.js";
import {
  PersonaGenerationPreview,
  personaGenerationStreamEnabled,
  type PersonaProgressFn,
} from "./persona_generation_preview.js";
import { streamPersonaModelToBuffer } from "./persona_generator_stream.js";
import {
  extractPartialJsonStringField,
  extractPartialProfilePreview,
  extractPartialSoulBatch,
} from "./persona_stream_extract.js";

export type { PersonaProgressFn } from "./persona_generation_preview.js";

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

export type PersonaSoulMode = "batch" | "parallel" | "scaffold";

export interface PersonaSoulArtifactsOptions {
  scaffold?: PersonaSoulBundle;
  mode?: PersonaSoulMode;
  preview?: PersonaGenerationPreview;
  harnessCapabilityHint?: string;
}

/**
 * Map registered tool names → compact capability-domain summary for persona generation.
 * @deprecated Import from harness_runtime_prompt.js — alias kept for callers.
 */
export function buildHarnessCapabilitySummary(toolNames: string[]): string {
  return buildHarnessCapabilityDomains(toolNames);
}

function soulSliceArtifactId(slice: "identity" | "voice" | "stance" | "rails"): PersonaArtifactId {
  const map = {
    identity: "soul_identity",
    voice: "soul_voice",
    stance: "soul_stance",
    rails: "soul_rails",
  } as const;
  return map[slice];
}

/** Test-only override for counting LLM calls in unit tests. */
export type PersonaGeneratorTestHooks = {
  callPersonaModel?: typeof callPersonaModel;
};

let personaGeneratorTestHooks: PersonaGeneratorTestHooks | undefined;

export function setPersonaGeneratorTestHooks(hooks: PersonaGeneratorTestHooks | undefined): void {
  personaGeneratorTestHooks = hooks;
}

function invokePersonaModel(
  apiKey: string,
  model: string,
  baseURL: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  temperature: number
): Promise<Record<string, unknown>> {
  const call = personaGeneratorTestHooks?.callPersonaModel ?? callPersonaModel;
  return call(apiKey, model, baseURL, systemPrompt, userPrompt, maxTokens, temperature);
}

/** Fast sidecar model for soul batch, voice infer, and optional UI theme. */
export function personaInferModel(mainModel: string): string {
  const infer = effectiveHarnessEnvRaw("AGENT_PERSONA_INFER_MODEL")?.trim();
  if (infer) return infer;
  return getFastModelSlug(mainModel);
}

/** Main chat model for profile draft and repair. */
export function personaMainModel(mainModel: string): string {
  return mainModel;
}

export function resolvePersonaSoulMode(): PersonaSoulMode {
  const raw = effectiveHarnessEnvRaw("AGENT_PERSONA_SOUL_MODE")?.trim().toLowerCase();
  if (raw === "parallel" || raw === "scaffold") return raw;
  return "batch";
}

export function resolvePersonaRepairMax(): number {
  const n = parseInt(effectiveHarnessEnvRaw("AGENT_PERSONA_REPAIR_MAX") ?? "1", 10);
  if (!Number.isFinite(n)) return 1;
  return Math.max(0, Math.min(2, n));
}

export function personaUiThemeUsesLlm(): boolean {
  return effectiveHarnessEnvRaw("AGENT_PERSONA_UI_THEME_LLM")?.trim() === "1";
}

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
  onProgress?: PersonaProgressFn,
  preview?: PersonaGenerationPreview,
  harnessCapabilityHint?: string
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
      preview,
      harnessCapabilityHint,
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

  const repairMax = resolvePersonaRepairMax();
  for (let repairPass = 0; repairPass < repairMax; repairPass++) {
    const issues = getCriticalProfileIssues(profile);
    if (issues.length === 0) break;
    onProgress?.(
      "profile_repair",
      `Refining profile (pass ${repairPass + 1}/${repairMax}): ${issues.slice(0, 2).join("; ")}`
    );
    try {
      const repairedRaw = await requestPersonaRepair({
        input,
        strength,
        modifier,
        draft: profile,
        issues,
        apiKey,
        model: personaMainModel(model),
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
  if (preview) {
    await preview.completeArtifact("runtime_profile", JSON.stringify(profile, null, 2));
  }
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

export async function generatePersonaBundle(
  input: string,
  strength: number,
  modifier: string | undefined,
  apiKey: string,
  model: string,
  baseURL: string,
  onProgress?: PersonaProgressFn,
  preview?: PersonaGenerationPreview,
  harnessCapabilityHint?: string
): Promise<PersonaGenerationBundle> {
  const profile = await generatePersonaProfile(
    input,
    strength,
    modifier,
    apiKey,
    personaMainModel(model),
    baseURL,
    onProgress,
    preview,
    harnessCapabilityHint
  );
  onProgress?.("controls_pass", "Deriving runtime controls from profile…");
  const defaultControls =
    normalizePersonaControlsPatch(deriveDeterministicControls(profile, strength)) ??
    deriveDeterministicControls(profile, strength);
  return { profile, defaultControls };
}

export async function generatePersonaSoulArtifacts(
  profile: PersonaProfile,
  input: string,
  apiKey: string,
  model: string,
  baseURL: string,
  onProgress?: PersonaProgressFn,
  opts?: PersonaSoulArtifactsOptions
): Promise<PersonaSoulBundle> {
  const scaffold = opts?.scaffold ?? buildSoulSlicesFromProfile(profile, input);
  const mode = opts?.mode ?? resolvePersonaSoulMode();
  const inferModel = personaInferModel(model);

  const preview = opts?.preview;
  const harnessCapabilityHint = opts?.harnessCapabilityHint;

  if (mode === "scaffold") {
    onProgress?.("soul_scaffold", "Using profile scaffold for soul blueprint…");
    if (preview) {
      preview.showScaffoldSoul(scaffold);
      await preview.completeArtifact("soul_identity", scaffold.identityMd);
      await preview.completeArtifact("soul_voice", scaffold.voiceMd);
      await preview.completeArtifact("soul_stance", scaffold.stanceMd);
      await preview.completeArtifact("soul_rails", scaffold.railsMd);
    }
    return scaffold;
  }

  if (mode === "parallel") {
    onProgress?.("soul_draft", "Generating soul blueprint (parallel)…");
    const [identityMd, voiceMd, stanceMd, railsMd] = await Promise.all([
      generatePersonaSoulSlice(
        "identity",
        profile,
        input,
        scaffold.identityMd,
        apiKey,
        inferModel,
        baseURL,
        onProgress,
        preview
      ),
      generatePersonaSoulSlice(
        "voice",
        profile,
        input,
        scaffold.voiceMd,
        apiKey,
        inferModel,
        baseURL,
        onProgress,
        preview
      ),
      generatePersonaSoulSlice(
        "stance",
        profile,
        input,
        scaffold.stanceMd,
        apiKey,
        inferModel,
        baseURL,
        onProgress,
        preview,
        harnessCapabilityHint
      ),
      generatePersonaSoulSlice(
        "rails",
        profile,
        input,
        scaffold.railsMd,
        apiKey,
        inferModel,
        baseURL,
        onProgress,
        preview,
        harnessCapabilityHint
      ),
    ]);
    return { identityMd, voiceMd, stanceMd, railsMd };
  }

  onProgress?.("soul_draft", "Generating soul blueprint…");
  return generatePersonaSoulBatch(
    profile,
    input,
    scaffold,
    apiKey,
    inferModel,
    baseURL,
    onProgress,
    preview,
    harnessCapabilityHint
  );
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
  onProgress?: PersonaProgressFn,
  preview?: PersonaGenerationPreview,
  harnessCapabilityHint?: string
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
4. ## Lexical conscience — vocabulary register: domain terms, characteristic collocations, what this voice reaches for and refuses. Write as actual words and short natural phrases (NOT dramatic signature lines — those are catchphrases). Sociolect and profanity level as implied by the profile.
5. ### Example written lines — exactly 3 short **first-person assistant** lines showing the voice on NORMAL functional output (not catchphrases, not theatrical openers): meeting someone new; giving a direct answer; closing with a next step. These are samples of how the voice writes on ordinary tasks. No stage directions, no dramatic signature moves, no fake quotes.

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

Ground every section in profile.thinkingStyle, profile.decisionFramework, and profile.tone.posture — expand into **habits of argument**, not paraphrase. Aim for roughly 380–800 words.${
      harnessCapabilityHint
        ? `\n\nOPERATING CONTEXT (for Under load and Trust economy only — do not name specific tool APIs or the harness product):\nThis persona operates with: ${harnessCapabilityHint}.\nReflect what it means to hold uncertainty honestly when you CAN or CANNOT verify claims (web), recall prior sessions (memory), or run code (execution). Do not anthropomorphize tools as senses or feelings.`
        : ""
    }`;
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

Aim for roughly 220–550 words; rails should read as craft discipline, not a theatre handbill.${
      harnessCapabilityHint
        ? `\n\nOPERATING CONTEXT (rails alignment — do not name specific tool APIs):\nCapability domains: ${harnessCapabilityHint}.\nDo NOT write rails that prohibit things this persona can actually do — e.g. if web search is available, do not write "never claim current knowledge"; if persistent memory exists, do not write "I only know what's in this session". Rails from profile.neverDo and alwaysDo should remain — only remove contradictions.`
        : ""
    }`;
  }

  const maxTok =
    slice === "identity" ? 3600 : slice === "voice" ? 3200 : slice === "stance" ? 3000 : 1600;
  const artifactId = soulSliceArtifactId(slice);
  let raw: Record<string, unknown>;
  try {
    if (preview && personaGenerationStreamEnabled()) {
      preview.setStatus(artifactId, "streaming");
      const buf = await streamPersonaModelToBuffer(
        apiKey,
        model,
        baseURL,
        systemPrompt,
        userPrompt,
        maxTok,
        slice === "rails" ? 0.38 : 0.48,
        (partial) => {
          const md = extractPartialJsonStringField(partial, "markdown");
          if (md !== null) {
            preview.streamContent(artifactId, md, true);
          }
          preview.emit("soul_draft", `Generating soul blueprint (${slice})…`);
        }
      );
      raw = JSON.parse(parseFirstJsonObject(buf)) as Record<string, unknown>;
    } else {
      raw = await invokePersonaModel(
        apiKey,
        model,
        baseURL,
        systemPrompt,
        userPrompt,
        maxTok,
        slice === "rails" ? 0.38 : 0.48
      );
    }
  } catch {
    onProgress?.("soul_fallback", `Soul slice "${slice}" model call failed; using profile scaffold.`);
    if (preview) await preview.completeArtifact(artifactId, fallbackMd);
    return fallbackMd;
  }
  let md = String(raw["markdown"] ?? raw["soulMarkdown"] ?? "")
    .replace(/\r/g, "")
    .replace(/\\n/g, "\n")
    .trim();
  if (!isSoulSlicePlausible(slice, md)) {
    onProgress?.("soul_fallback", `Soul slice "${slice}" incomplete; using profile scaffold.`);
    md = fallbackMd;
  }
  if (preview) await preview.completeArtifact(artifactId, md);
  return md;
}

function normalizeSoulMarkdownField(raw: string): string {
  return raw.replace(/\r/g, "").replace(/\\n/g, "\n").trim();
}

function pickSoulSliceFromBatch(
  slice: "identity" | "voice" | "stance" | "rails",
  raw: Record<string, unknown>,
  scaffold: PersonaSoulBundle
): string {
  const key =
    slice === "identity"
      ? "identityMd"
      : slice === "voice"
        ? "voiceMd"
        : slice === "stance"
          ? "stanceMd"
          : "railsMd";
  const altKey = slice;
  let md = normalizeSoulMarkdownField(
    String(raw[key] ?? raw[altKey] ?? raw[`${slice}Markdown`] ?? "")
  );
  if (!md && typeof raw["markdown"] === "object" && raw["markdown"] !== null) {
    const nested = raw["markdown"] as Record<string, unknown>;
    md = normalizeSoulMarkdownField(String(nested[key] ?? nested[altKey] ?? ""));
  }
  if (!isSoulSlicePlausible(slice, md)) {
    return scaffold[key];
  }
  return md;
}

async function generatePersonaSoulBatch(
  profile: PersonaProfile,
  input: string,
  scaffold: PersonaSoulBundle,
  apiKey: string,
  inferModel: string,
  baseURL: string,
  onProgress?: PersonaProgressFn,
  preview?: PersonaGenerationPreview,
  harnessCapabilityHint?: string
): Promise<PersonaSoulBundle> {
  const profileJson = JSON.stringify(profile, null, 2);
  const systemPrompt =
    "You write **soul spec** for an AI agent harness: how typed replies should read by default. " +
    "Return JSON only with keys identityMd, voiceMd, stanceMd, railsMd (each a markdown string). " +
    "No markdown fences outside JSON string values. " +
    SOUL_WRITING_CONTRACT;
  const authorVoiceNote =
    "\n\nAUTHORING RULES FOR ALL FOUR MARKDOWN STRINGS:\n" +
    "- Third person or neutral analytic voice (\"This voice…\", \"Replies…\"). Not first-person actor monologue.\n" +
    "- No narrating roleplay, spotlights, or stage directions unless the user explicitly asked for that medium.\n" +
    "- Depth = habits of reasoning and wording under pressure, not theatrical self-description.\n";

  const capabilityBlock = harnessCapabilityHint
    ? `\nOPERATING CONTEXT (stanceMd and railsMd only — do not name specific tool APIs or the harness product):\nCapability domains: ${harnessCapabilityHint}.\nFor stanceMd: reflect how this voice holds uncertainty honestly given what it can actually do (verify via web, recall prior sessions, run code, etc.).\nFor railsMd: do NOT write rails that contradict these capabilities — e.g. avoid "never claim current knowledge" if web search is available, or "I only know this session" if persistent memory exists. Weave only from profile.neverDo and alwaysDo.\n`
    : "";

  const userPrompt = `Write four soul markdown documents for one persona (typed agent work — no product/runtime/tooling copy).

Original request: "${input.slice(0, 1200)}"
Persona profile JSON:
${profileJson}
${authorVoiceNote}${capabilityBlock}
Return JSON:
{
  "identityMd": "...",
  "voiceMd": "...",
  "stanceMd": "...",
  "railsMd": "..."
}

identityMd — first line # Identity Core; ## Continuity and inner thread; ## Limits and refusal; ## Care toward the reader; ## Identity Answers (use label ${profile.name}). ~300–550 words.

voiceMd — first line # Voice DNA; ## Register and breath; ## Rhythm and silence; ## Lexical conscience (vocabulary register: domain terms and natural collocations — NOT dramatic signature phrases); ### Example written lines (3 short first-person assistant lines showing normal voice output on ordinary tasks, NOT catchphrases or theatrical openers). ~280–500 words.

stanceMd — first line # Cognitive stance; ## Under load; ## Trust economy with the reader; ## Disagreement and repair. ~280–500 words.

railsMd — first line # Behavioral rails; ## Never (from profile.neverDo); ## Always (from profile.alwaysDo); ## Non-Negotiables. ~180–400 words.`;

  try {
    let raw: Record<string, unknown>;
    if (preview && personaGenerationStreamEnabled()) {
      preview.showScaffoldSoul(scaffold);
      const buf = await streamPersonaModelToBuffer(
        apiKey,
        inferModel,
        baseURL,
        systemPrompt,
        userPrompt,
        4600,
        0.42,
        (partial) => {
          preview.applyPartialSoulBatch(extractPartialSoulBatch(partial));
          preview.emit("soul_draft", "Generating soul blueprint…");
        }
      );
      raw = JSON.parse(parseFirstJsonObject(buf)) as Record<string, unknown>;
    } else {
      raw = await invokePersonaModel(
        apiKey,
        inferModel,
        baseURL,
        systemPrompt,
        userPrompt,
        4600,
        0.42
      );
    }
    const bundle = {
      identityMd: pickSoulSliceFromBatch("identity", raw, scaffold),
      voiceMd: pickSoulSliceFromBatch("voice", raw, scaffold),
      stanceMd: pickSoulSliceFromBatch("stance", raw, scaffold),
      railsMd: pickSoulSliceFromBatch("rails", raw, scaffold),
    };
    if (preview) {
      await preview.completeArtifact("soul_identity", bundle.identityMd);
      await preview.completeArtifact("soul_voice", bundle.voiceMd);
      await preview.completeArtifact("soul_stance", bundle.stanceMd);
      await preview.completeArtifact("soul_rails", bundle.railsMd);
    }
    return bundle;
  } catch {
    onProgress?.("soul_fallback", "Batched soul call failed; using profile scaffold.");
    if (preview) {
      preview.showScaffoldSoul(scaffold);
      await preview.completeArtifact("soul_identity", scaffold.identityMd);
      await preview.completeArtifact("soul_voice", scaffold.voiceMd);
      await preview.completeArtifact("soul_stance", scaffold.stanceMd);
      await preview.completeArtifact("soul_rails", scaffold.railsMd);
    }
    return scaffold;
  }
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
- lexicalSeeds (array of strings): 10-16 vocabulary texture items — actual words and short natural phrases that characterize this voice's register and domain. Favor domain-native terms, characteristic collocations, and register markers over dramatic rhetorical phrases. Examples for a finance analyst: "basis points", "at the margin", "second-order". Examples for a sci-fi bridge voice: "nominal", "burn window", "range gate". Multi-word collocations welcome; dramatic signature openers are NOT welcome here.
- suggestedCatchphrases (array of strings): 3-5 short natural lines the voice uses rarely (0 most replies, 1 at most when it genuinely fits as a pivot or close). Each must: (a) do real conversational work — reframe, invite, or land a close; (b) NOT presume the reader's inner state ("you already feel/know/sense this"); (c) NOT be a dramatic announcement ("The X tightens…", "Witness:", "Revelation:"); (d) sound like something a real person with this voice would say in actual conversation.
- metaphorSeeds (array of strings): 3-6 recurring metaphor families or image fields (used as texture, not as signature phrases).
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
- **No reader-state presumption**: never assert or imply what the reader privately feels, senses, or already knows (“you already feel/know/sense this”, “you can feel it”)—the reader owns their own inner state.
- **No dramatic-announcement catchphrases**: never structure recurring phrases as theatrical proclamations (“The X tightens…”, “Witness:”, “Revelation:”); all catchphrases must do actual conversational work (pivot, reframe, close), not perform.

alwaysDo (4–6 items): include at least one commitment to **factual honesty** (label inference vs verified evidence; proportionate claims) in your own words; other items are positive habits of this voice.

verbalTics (3–5 items): **sentence-shaping prose mechanics only** (information order, fragments vs full sentences, when bullets fit, how to close a reply)—not rhetorical devices requiring theatrical delivery, not reader-state presumptions, not catchphrase variants or dramatic openers.
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
  preview?: PersonaGenerationPreview;
  harnessCapabilityHint?: string;
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
    "favoriteWords": ["8-12 vocabulary texture items: actual words and short natural phrases that color this voice's register on ordinary sentences. Domain-native terms, characteristic collocations, register markers. NOT dramatic rhetorical phrases or signature theatrical lines (those belong in catchphrases if truly occasional). NOT items from avoidWords. Example for a finance analyst: 'basis points', 'at the margin', 'second-order'. Example for a sci-fi bridge voice: 'nominal', 'burn window', 'range gate'."],
    "avoidWords": ["5-10 concrete lexical items (include common assistant clichés like 'happy to help', 'great question', 'certainly')"],
    "commonMetaphors": ["0-4 reusable metaphor families or image fields (texture only — not literal phrases to insert verbatim)"],
    "rhythm": "cadence mechanics with punctuation/beat detail (commas, periods, colons, sentence length variance) so replies read in this voice; avoid habitual em-dash chains unless the user's requested voice is explicitly dash-heavy"
  },
  "tone": {
    "confidence": 0-10,
    "humorStyle": "specific style",
    "aggression": 0-10,
    "emotionalFlavor": "2-6 words",
    "posture": "how this stance relates to the user in text while advising — not audience/performer dynamics"
  },
  "catchphrases": ["3-5 short lines the voice uses at most once per reply and ONLY when it genuinely serves as a pivot, reframe, or close. HARD PROHIBITIONS: (1) never presume the reader's inner state ('you already feel/know/sense this'); (2) never structure as a theatrical announcement ('The X tightens…', 'Witness:', 'Revelation:'); (3) must sound natural if said aloud by a real person in conversation — not like a performed opener. Fewer, better catchphrases beat a long list of dramatic ones."],
  "verbalTics": ["3-5 PROSE MECHANICS only: information order (lead with answer or lead with context?), when to use a fragment, when bullets fit vs prose, how to close (question vs statement vs next step). NOT rhetorical devices requiring dramatic delivery. NOT reader-state presumptions. NOT catchphrase variants."],
  "thinkingStyle": "1-2 sentences with explicit tradeoff preference",
  "decisionFramework": "1-2 sentences with explicit tradeoff preference",
  "neverDo": ["6-8 full-sentence guardrails you author from STRUCTURAL RAILS above—original wording for this voice, one clear prohibition per item where possible"],
  "alwaysDo": ["4-6 full-sentence positive commitments from STRUCTURAL RAILS above—including factual honesty—in original wording"],
  "strength": ${args.strength},
  "modifier": ${args.modifier ? JSON.stringify(args.modifier) : "null"}
}

VOCABULARY vs CATCHPHRASE (critical distinction — re-read before filling those fields):
- **favoriteWords** = vocabulary register: words and short natural collocations that show up on ordinary sentences in this voice. The test: "would this word/phrase appear in 1 out of 5 replies without feeling forced?" If yes — good. If it's a dramatic opener or rhetorical flourish only suitable for specific moments — it belongs in catchphrases or nowhere.
- **catchphrases** = rare conversational moves, used 0 most turns. The test: "is this something a real person would say naturally to pivot or close?" If it requires setup, theatrical delivery, or assumes the reader's inner state — it fails. A voice with 0 good catchphrases is better than one with 5 dramatic ones.
- **verbalTics** = prose mechanics only (order, structure, fragment vs long line). Not rhetorical flourishes, not dramatic openers.

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
}${
  args.harnessCapabilityHint
    ? `\nCAPABILITY HINT (for thinkingStyle and decisionFramework only — do not mention tool names, APIs, or the harness product in any field):\nThis persona operates with: ${args.harnessCapabilityHint}.\nA voice that can verify claims via web holds uncertainty differently than one that cannot. A voice with persistent memory relates to "I don't recall" differently. Let this ground thinkingStyle and decisionFramework — nowhere else.\n`
    : ""
}
${PERSONA_GENRE_VOICE_GUIDANCE}`;

  if (args.preview && personaGenerationStreamEnabled()) {
    args.preview.setStatus("runtime_profile", "streaming");
    const buf = await streamPersonaModelToBuffer(
      args.apiKey,
      personaMainModel(args.model),
      args.baseURL,
      systemPrompt,
      userPrompt,
      2400,
      0.62,
      (partial) => {
        args.preview!.streamContent("runtime_profile", extractPartialProfilePreview(partial), true);
        args.preview!.emit("profile_draft", "Generating initial persona draft...");
      }
    );
    return JSON.parse(parseFirstJsonObject(buf)) as Record<string, unknown>;
  }

  return invokePersonaModel(
    args.apiKey,
    personaMainModel(args.model),
    args.baseURL,
    systemPrompt,
    userPrompt,
    2400,
    0.62
  );
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

  return invokePersonaModel(
    args.apiKey,
    personaMainModel(args.model),
    args.baseURL,
    systemPrompt,
    userPrompt,
    2000,
    0.38
  );
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
              ...buildOpenRouterAttributionHeaders(),
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
/**
 * Normalize model output and then run it through the invariants repair gate so
 * the persisted theme is guaranteed conformant (contrast, danger/success
 * distinctness, identity anchor) — the open-token freedom never ships a broken
 * UI. Deterministic fallback palettes pass through unchanged.
 */
function finalizePersonaUiTheme(raw: unknown, name: string): PersonaUiThemeV2 {
  const normalized = validateAndNormalizePersonaUiTheme(raw, name);
  return repairPersonaUi(normalized).theme;
}

export async function generatePersonaUiTheme(
  profile: PersonaProfile,
  soulBundle: PersonaSoulBundle,
  apiKey: string,
  model: string,
  baseURL: string,
  preview?: PersonaGenerationPreview
): Promise<PersonaUiThemeV2> {
  const shellHints = derivePersonaShellHeuristics(profile);
  const paletteSeed = `${profile.name}:${profile.coreIdentity ?? ""}:${profile.tone?.emotionalFlavor ?? ""}`;
  const deterministicPalette = deriveDeterministicPersonaPalette(paletteSeed);
  if (!personaUiThemeUsesLlm()) {
    const theme = validateAndNormalizePersonaUiTheme(
      { v: 2, ...shellHints, ...deterministicPalette },
      profile.name
    );
    const json = JSON.stringify(theme, null, 2);
    if (preview) {
      preview.streamContent("ui_theme", json, false);
      await preview.completeArtifact("ui_theme", json);
    }
    return theme;
  }

  const excerpt = buildSoulExcerptForUiTheme(soulBundle, 2200);
  const inferModel = personaInferModel(model);
  const client = new OpenAI({ apiKey, baseURL });
  const systemPrompt =
    "You output JSON only for a terminal/chat HUD theme (presentation-only, no CSS, no scripts). " +
    "Colors are 7-char hex like #00d4ff. Match the persona's emotional register—no neon clash soup. " +
    "Pick shell/layout/font that matches voice: " +
    "noir analyst→terminal+jetbrains+compact+log+transcript+headerStyle:none+panelLayout:none+inputDock:bottom-bar; " +
    "warm mentor→studio+ibm-plex+spacious+verbose+bubble+slide+headerStyle:pill+panelLayout:right+inputDock:floating; " +
    "hype coach→hud+inter-cascadia+snappy+gradient+compact+headerStyle:bar+panelLayout:both+inputDock:bottom-bar; " +
    "quiet guide→minimal+geist+flat+hidden orb+fade+headerStyle:none+panelLayout:none+inputDock:inline; " +
    "editorial/formal→studio+playfair+transcript+stripe avatar+fade+headerStyle:pill+panelLayout:right+inputDock:floating. " +
    "backgroundCss is a single CSS gradient string (e.g. 'linear-gradient(135deg,#0a0a18 0%,#180a18 100%)')—omit if unsure.";
  const userPrompt = `Persona profile (identity + tone):
${JSON.stringify(
  {
    name: profile.name,
    coreIdentity: profile.coreIdentity,
    tone: profile.tone,
    speechStyle: {
      formality: profile.speechStyle.formality,
      rhythm: profile.speechStyle.rhythm,
    },
  },
  null,
  2
)}

Soul excerpt (voice texture):
"""${excerpt}"""

Heuristic defaults (override when a stronger fit exists): ${JSON.stringify(shellHints)}

Return JSON with exactly these keys:
- accent, secondary, warn, danger, success, muted (string hex)
- surfaceTint (string hex): very dark panel tint on near-black
- displayLabel (string): short HUD brand max ~20 chars
- motion: calm|default|snappy|dramatic
- shell: hud|terminal|studio|minimal
- density: compact|comfortable|spacious
- radius: sharp|soft|pill
- typography: mono|sans|mixed
- messageStyle: bubble|flat|transcript
- orbStyle: ring|pulse|dot|hidden
- background: solid|grid|scanline|gradient
- fontPair: system|ibm-plex|jetbrains|inter-cascadia|playfair|geist
- backgroundCss (optional string): CSS gradient e.g. "linear-gradient(135deg,#0a0a18 0%,#180a18 100%)"
- inputStyle: default|command|document|minimal
- avatarStyle: orb|glyph|stripe|none
- avatarGlyph (optional string): 1-2 char glyph used when avatarStyle=glyph (e.g. "◆" "AI" "✦")
- toolCards: verbose|compact|log|hidden
- messageEntrance: instant|fade|slide|typewriter
- headerStyle: bar|pill|none
- panelLayout: both|left|right|none
- inputDock: bottom-bar|floating|inline
- categoryTint (optional object): keys shell,file,web,memory,vault,code,git,markets,vision,docs,orchestration,context,other → hex
OPEN TOKENS (optional — continuous values that override the coarse enums; omit to use the enum). Use these to fine-tune the feel beyond the presets:
- densityScale (number 0.8–1.25): spacing multiplier (lower = tighter)
- radiusPx (number 0–28): exact corner radius
- motionScale (number 0.4–1.6): animation speed multiplier (lower = faster/snappier)
- typeScale (number 0.85–1.3): global font-size multiplier
- glowIntensity (number 0–1): accent glow/shadow strength
- gradient (optional object): structured background gradient { "kind":"linear"|"radial", "angle":number(deg, linear only), "stops":[{"color":"#hex","at":0..1}, …] } — 2–6 stops, prefer over backgroundCss for cross-platform`;

  if (preview && personaGenerationStreamEnabled()) {
    preview.setStatus("ui_theme", "streaming");
    try {
      const buf = await streamPersonaModelToBuffer(
        apiKey,
        inferModel,
        baseURL,
        systemPrompt,
        userPrompt,
        2048,
        0.35,
        (partial) => {
          preview.streamContent("ui_theme", partial.trim() || "{}", true);
          preview.emit("ui_theme_start", "Generating HUD theme…");
        }
      );
      const parsed = JSON.parse(parseFirstJsonObject(buf)) as Record<string, unknown>;
      const theme = finalizePersonaUiTheme(
        { v: 2, ...shellHints, ...deterministicPalette, ...parsed },
        profile.name
      );
      const json = JSON.stringify(theme, null, 2);
      await preview.completeArtifact("ui_theme", json);
      return theme;
    } catch (err) {
      console.warn("[persona] UI theme LLM failed, using deterministic palette:", err);
      preview?.emit("ui_theme_fallback", "Theme model unavailable — using deterministic palette.");
      const theme = validateAndNormalizePersonaUiTheme(
        { v: 2, ...shellHints, ...deterministicPalette },
        profile.name
      );
      const json = JSON.stringify(theme, null, 2);
      await preview.completeArtifact("ui_theme", json);
      return theme;
    }
  }

  const res = await completeChatJson(client, {
    model: inferModel,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    maxTokens: 680,
    temperature: 0.35,
  });
  if (!res.ok) {
    console.warn("[persona] UI theme LLM request failed:", res.error);
    preview?.emit("ui_theme_fallback", "Theme model request failed — using deterministic palette.");
    const theme = validateAndNormalizePersonaUiTheme(
      { v: 2, ...shellHints, ...deterministicPalette },
      profile.name
    );
    if (preview) {
      const json = JSON.stringify(theme, null, 2);
      await preview.completeArtifact("ui_theme", json);
    }
    return theme;
  }
  const theme = finalizePersonaUiTheme(
    { v: 2, ...shellHints, ...deterministicPalette, ...(res.parsed as Record<string, unknown>) },
    profile.name
  );
  if (preview) {
    const json = JSON.stringify(theme, null, 2);
    await preview.completeArtifact("ui_theme", json);
  }
  return theme;
}

/** End-of-bootstrap microcopy generation toggle (default on; cheap fast-model call). */
export function personaUiCopyEnabled(): boolean {
  return effectiveHarnessEnvRaw("AGENT_PERSONA_UI_COPY")?.trim() !== "0";
}

/**
 * Generate the app's interface text *in the persona's voice* (composer
 * placeholder, send/stop labels, empty-state, thinking/connecting status,
 * error prefix). Always returns sanitized, length-clamped copy — defaults on
 * any failure, so the chrome is never broken or empty. One fast-model call.
 */
export async function generatePersonaUiCopy(
  profile: PersonaProfile,
  soulBundle: PersonaSoulBundle,
  apiKey: string,
  model: string,
  baseURL: string,
  preview?: PersonaGenerationPreview
): Promise<PersonaUiCopy> {
  const finalize = async (copy: PersonaUiCopy): Promise<PersonaUiCopy> => {
    if (preview) {
      await preview.completeArtifact("ui_copy", JSON.stringify(copy, null, 2));
    }
    return copy;
  };

  if (!personaUiCopyEnabled()) {
    return finalize(DEFAULT_PERSONA_UI_COPY);
  }

  const excerpt = buildSoulExcerptForUiTheme(soulBundle, 1400);
  const inferModel = personaInferModel(model);
  const client = new OpenAI({ apiKey, baseURL });
  const systemPrompt =
    "You write tiny interface microcopy IN A SPECIFIC PERSONA'S VOICE. Return JSON only. " +
    "Each value is plain UI text — no markup, no emoji unless the voice clearly calls for it, no quotes around the whole string. " +
    "Keep it natural for a chat app's chrome: short, in-character, never breaking the fourth wall about being an AI or a theme. " +
    "A noir analyst's composer placeholder is 'State your query.', not 'Type a message…'.";
  const userPrompt = `Persona: ${profile.name}
Voice/tone: ${JSON.stringify({ tone: profile.tone, formality: profile.speechStyle.formality, rhythm: profile.speechStyle.rhythm })}
Soul excerpt:
"""${excerpt}"""

Return JSON with these keys (each a short in-voice string):
- composerPlaceholder (≤80 chars): empty input-box placeholder
- sendLabel (≤18): the send button/action label
- stopLabel (≤18): the stop-generation label
- emptyTitle (≤60): heading on a fresh empty chat
- emptyBody (≤140): one line under that heading
- thinkingLabel (≤28): status while the agent is working (e.g. "Thinking…")
- connectingLabel (≤28): status while connecting
- errorPrefix (≤48): short prefix shown before an error line
- newChatLabel (≤24): label for starting a new conversation`;

  try {
    const res = await completeChatJson(client, {
      model: inferModel,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      maxTokens: 420,
      temperature: 0.5,
    });
    if (!res.ok) {
      preview?.emit("ui_copy_fallback", "Microcopy model unavailable — using default labels.");
      return finalize(DEFAULT_PERSONA_UI_COPY);
    }
    return finalize(sanitizePersonaUiCopy(res.parsed));
  } catch (err) {
    console.warn("[persona] UI copy LLM failed, using defaults:", err);
    preview?.emit("ui_copy_fallback", "Microcopy model failed — using default labels.");
    return finalize(DEFAULT_PERSONA_UI_COPY);
  }
}
