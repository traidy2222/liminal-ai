import OpenAI from "openai";
import {personaGenerationSignal,checkPersonaCancellation} from './persona_transaction.js';
import {
  completeChatJson,
  getFastModelSlug,
  isLocalProviderUrl,
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
  /** Vocabulary-texture examples used DESCRIPTIVELY to compose the register string — never injected as mandatory words. */
  lexicalSeeds: string[];
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
  if(isLocalProviderUrl(effectiveHarnessEnvRaw('AGENT_API_BASE_URL')??''))return mainModel;
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
  if (raw === "parallel" || raw === "batch") return raw;
  return "scaffold";
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
/** Explicit names are display data, never model-authored instructions. */
export function requestedPersonaName(input:string,explicit?:string):string|undefined {
 const clean=(value:string)=>{
  const name=value.trim().replace(/^["“”']+|["“”']+$/g,'').replace(/\s+/g,' ');
  if(name.length>80||/[<>\r\n]/.test(value))throw Error('Use a name of up to 80 characters on one line.');
  return name||undefined;
 };
 if(explicit?.trim())return clean(explicit);
 const label=input.match(/(?:^|\n)\s*(?:name|persona name|assistant name)\s*:\s*([^\n]+)/i);
 if(label)return clean(label[1]!);
 const named=input.match(/\b(?:named|called|your name is|call you)\s+["“]?([^\n,.;!?]+?)(?=["”]|\s+(?:with|who|but|and|that)\b|$)/i);
 if(named)return clean(named[1]!);
 const role=input.match(/^(?:you are|act as|embody|be|based on|inspired by)\s+([^\n,.;!?]+?)(?=\s+(?:with|who|but)\b|[,.;!?]|$)/i);
 if(role&&role[1]!.trim().split(/\s+/).length<=4)return clean(role[1]!);
 if(/^[\p{L}][\p{L}\p{N}'’.-]*(?:\s+[\p{L}][\p{L}\p{N}'’.-]*){0,3}$/u.test(input.trim()))return clean(input);
 return undefined;
}

export async function generatePersonaProfile(
  input: string,
  strength: number,
  modifier: string | undefined,
  apiKey: string,
  model: string,
  baseURL: string,
  onProgress?: PersonaProgressFn,
  preview?: PersonaGenerationPreview,
  harnessCapabilityHint?: string,
  explicitName?: string
): Promise<PersonaProfile> {
  const desiredName=requestedPersonaName(input,explicitName);
  const voiceEnvelope: PersonaVoiceEnvelope | null = null;

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
    checkPersonaCancellation();
    throw new Error('The selected model could not generate a personality. Check the connection and credits, then retry or use the built-in personality.');
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

  if(desiredName)profile={...profile,name:desiredName};
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
      if(desiredName)profile={...profile,name:desiredName};
    } catch {
      onProgress?.("profile_fill", "Repair call failed; completing profile deterministically...");
      profile = ensureProfileComplete(profile, input, strength, modifier, voiceEnvelope);
      break;
    }
  }

  profile = ensureProfileComplete(profile, input, strength, modifier, voiceEnvelope);
  if(desiredName)profile={...profile,name:desiredName};
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
  harnessCapabilityHint?: string,
  explicitName?: string
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
    harnessCapabilityHint,
    explicitName
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
4. ## Lexical conscience — vocabulary register: domain terms, characteristic collocations, what this voice reaches for and refuses. Write as actual words and short natural phrases describing the register (NOT dramatic signature lines the voice would repeat). Sociolect and profanity level as implied by the profile.
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
function enforceStructuralRails(profile:PersonaProfile,_userInput=''):PersonaProfile {
  return {...profile,neverDo:dedupeStrings(profile.neverDo).slice(0,8),alwaysDo:dedupeStrings(profile.alwaysDo).slice(0,8),
    speechStyle:{...profile.speechStyle,avoidWords:dedupeStrings(profile.speechStyle.avoidWords).slice(0,12)}};
}

function isEnvelopeUsable(envelope: PersonaVoiceEnvelope): boolean {
  const textLen = envelope.archetypeSummary.length + envelope.voiceNotes.length;
  const seeds = envelope.lexicalSeeds.length + envelope.metaphorSeeds.length;
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

  const avoidWords = dedupeStrings([
    ...avoidBase,
    ...(envelope.homageToRealFigure ? ["according to my sources", "I remember when I met"] : []),
  ]).slice(0, 12);

  const lexBits = dedupeStrings([...envelope.lexicalSeeds, ...envelope.metaphorSeeds]).slice(0, 12);
  const registerParts = [
    envelope.archetypeSummary ? `Diction drawn from: ${envelope.archetypeSummary}.` : "",
    lexBits.length > 0
      ? `Reaches naturally toward vocabulary like ${lexBits.slice(0, 10).join(", ")} — as texture the voice lives in, not a checklist to insert.`
      : "",
    envelope.sociolectNotes ? `Sociolect: ${envelope.sociolectNotes}.` : "",
    envelope.genreTags.length > 0 ? `Stays native to ${envelope.genreTags.slice(0, 5).join(", ")}.` : "",
    envelope.profanityRegister !== "none"
      ? `In-character profanity level: ${envelope.profanityRegister} — do not sanitize into polite assistant English.`
      : "",
    "Never genericizes into corporate-assistant warmth.",
  ].filter((p) => p.length > 0);
  const register = sanitizeText(registerParts.join(" ")).slice(0, PFL.speechMechanics);

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
      register,
      avoidWords,
      rhythm:
        envelope.rhythmHint.slice(0, PFL.speechMechanics) ||
        "Staccato leads when stakes rise; room to breathe when teaching.",
    },
    tone,
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
function buildFallbackDraftRaw(input:string,strength:number,modifier:string|undefined,_envelope?:PersonaVoiceEnvelope|null): Record<string,unknown> {
  return {name:'Liminal',coreIdentity:`An assistant with the writing style requested by the user: ${input}`,
    background:'',selfImage:'',speechStyle:{sentenceStructure:'Natural sentences matching the brief.',formality:'mixed',register:input,avoidWords:[],rhythm:'Adapt to the conversation.'},
    tone:{confidence:5,humorStyle:'As requested by the user.',aggression:0,emotionalFlavor:'natural',posture:'collaborative'},
    thinkingStyle:'',decisionFramework:'',neverDo:[],alwaysDo:[],strength,modifier};
}

/** Fills shallow fields and, if needed, replaces with a full local scaffold so validation always passes. */
function ensureProfileComplete(profile:PersonaProfile,input:string,strength:number,modifier:string|undefined,voiceEnvelope?:PersonaVoiceEnvelope|null):PersonaProfile {
  if(getCriticalProfileIssues(profile).length===0)return profile;
  const fallback=sanitizeProfile(buildFallbackDraftRaw(input,strength,modifier,voiceEnvelope),input,strength,modifier,voiceEnvelope);
  return {...profile,name:profile.name||fallback.name,coreIdentity:profile.coreIdentity||fallback.coreIdentity,
    speechStyle:{...profile.speechStyle,sentenceStructure:profile.speechStyle.sentenceStructure||fallback.speechStyle.sentenceStructure,
      register:profile.speechStyle.register||fallback.speechStyle.register,rhythm:profile.speechStyle.rhythm||fallback.speechStyle.rhythm}};
}

/** Deterministic soul slices from profile only (no model). Mirrors required headings for {@link isSoulSlicePlausible}. */
export function buildSoulSlicesFromProfile(profile: PersonaProfile, input: string): PersonaSoulBundle {
  return {
    identityMd:['# Identity Core',profile.coreIdentity,'## Background and grounding',profile.background,'## Self-image',profile.selfImage].filter(Boolean).join('\n\n'),
    voiceMd:['# Voice',profile.speechStyle.sentenceStructure,profile.speechStyle.register,profile.speechStyle.rhythm,`User brief: ${input}`].filter(Boolean).join('\n\n'),
    stanceMd:['# Cognitive stance',profile.thinkingStyle,profile.decisionFramework].filter(Boolean).join('\n\n'),
    railsMd:['# Behavioral preferences',...profile.neverDo.map(x=>`Avoid: ${x}`),...profile.alwaysDo.map(x=>`Prefer: ${x}`)].join('\n'),
  };
}

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
  const avoidWords = dedupeStrings(arr(speechRaw["avoidWords"], 60)).slice(0, 12);
  const name = coercePersonaName(raw["name"], voiceEnvelope);

  // Back-compat: older drafts/personas may carry favoriteWords/commonMetaphors arrays.
  // Fold any such legacy texture into the descriptive `register` string rather than dropping it.
  const legacyLex = dedupeStrings([
    ...arr(speechRaw["favoriteWords"], 60),
    ...arr(speechRaw["commonMetaphors"], 120),
  ]).slice(0, 12);
  let register = clip(speechRaw["register"], PFL.speechMechanics, "");
  if (!register && legacyLex.length > 0) {
    register = sanitizeText(
      `Reaches naturally toward vocabulary like ${legacyLex.join(", ")} — as texture the voice lives in, not a checklist.`
    ).slice(0, PFL.speechMechanics);
  }

  return {
    name,
    coreIdentity: clip(raw["coreIdentity"], PFL.coreIdentity, ""),
    background: clip(raw["background"], PFL.background, ""),
    selfImage: clip(raw["selfImage"], PFL.selfImage, ""),
    speechStyle: {
      sentenceStructure: clip(speechRaw["sentenceStructure"], PFL.speechMechanics, ""),
      formality: validateFormality(speechRaw["formality"]),
      register,
      avoidWords,
      rhythm: clip(speechRaw["rhythm"], PFL.speechMechanics, ""),
    },
    tone: {
      confidence: num(toneRaw["confidence"]),
      humorStyle: clip(toneRaw["humorStyle"], PFL.humorStyle, ""),
      aggression: num(toneRaw["aggression"]),
      emotionalFlavor: clip(toneRaw["emotionalFlavor"], PFL.emotionalFlavor, ""),
      posture: clip(toneRaw["posture"], PFL.posture, ""),
    },
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
  const metaphorSeeds = dedupeStrings(toStringArray(o["metaphorSeeds"], 100)).slice(0, 8);
  const rhythmHint = sanitizeText(String(o["rhythmHint"] ?? "")).slice(0, 320);
  const sentenceMechanicsHint = sanitizeText(String(o["sentenceMechanicsHint"] ?? "")).slice(0, 320);
  const postureHint = sanitizeText(String(o["postureHint"] ?? "")).slice(0, 320);
  const homageToRealFigure = Boolean(o["homageToRealFigure"]);

  if (lexicalSeeds.length < 6) {
    const bits = voiceNotes
      .split(/(?<=[.!?])\s+/)
      .flatMap((s) => sanitizeText(s).split(/[,;]+/))
      .map((s) => sanitizeText(s))
      .filter((s) => s.length > 4 && s.length < 80);
    lexicalSeeds = dedupeStrings([...lexicalSeeds, ...metaphorSeeds, ...bits]).slice(0, 22);
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
    isLocalProviderUrl(args.baseURL)?args.model:effectiveHarnessEnvRaw("AGENT_PERSONA_INFER_MODEL")?.trim() || getFastModelSlug(args.model);
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
- lexicalSeeds (array of strings): 10-16 vocabulary texture items — actual words and short natural collocations that characterize this voice's register and domain. These are used DESCRIPTIVELY to compose a register summary, never injected verbatim. Favor domain-native terms and register markers over dramatic rhetorical phrases. Examples for a finance analyst: "basis points", "at the margin", "second-order". Examples for a sci-fi bridge voice: "nominal", "burn window", "range gate".
- metaphorSeeds (array of strings): 3-6 recurring metaphor families or image fields (used as texture, not as signature phrases).
- rhythmHint (string): one sentence on punctuation, beat, sentence-length variance.
- sentenceMechanicsHint (string): one sentence on fragments vs long lines, parallelism, rhetorical questions, etc.
- postureHint (string): one sentence on how they relate to the person they advise.
- profanityRegister (string): one of none|mild|strong — **strong** when the user wants frequent in-character swearing or a famously vulgar voice; **mild** for occasional spice; **none** otherwise.
- sociolectNotes (string): concrete regional/class dialect notes (e.g. South African English markers, code-switching, AAVE features the user requested)—empty string "" if not applicable.

VOICE vs THEATRE: lexicalSeeds and voiceNotes should describe **how this voice types** in a task-first assistant chat—not stage directions, not narrated physical performance, not anthropomorphizing software as a body or inner life, unless the user explicitly asked for that conceit.`;

  const res = await completeChatJson(client, {
    signal: personaGenerationSignal(),
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

/** Injected into draft/repair (and related) prompts so the model authors rails from shared context — not matched by regex afterward. */
const PERSONA_STRUCTURAL_RAILS_GUIDE = `Describe the user's requested communication style. Do not invent operational rules, mandatory phrases, banned vocabulary or behavioral restrictions. neverDo, alwaysDo and avoidWords may be empty; include only preferences the user actually requested. Harness permissions and factual standards live outside the persona.`;

const PERSONA_GENRE_VOICE_GUIDANCE = `
GENRE AND REGISTER (infer from the user's description—apply the best match; blend if hybrid):
- **Science fiction / speculative**: Build **in-world** lexical texture (shipboard, civic, military, academic, street, or hive-register as fits). Invent or repurpose **setting-native** collocations and address forms; avoid modern Silicon Valley / HR / "life coach" clichés unless the user explicitly asked for a corporate-future satire. Name the **subgenre** (e.g. hard SF, space opera, cyberpunk) inside speechStyle.rhythm or tone.posture when it tightens voice.
- **Fantasy / myth**: Consistent **register** (high archaism vs low vernacular vs scholarly) per user ask; metaphors from the world's physics/society, not random modern office jokes unless anachronism is the joke.
- **Real historical figure or period voice**: Encode **period-appropriate diction, honorifics, oath texture, rhetorical rhythm, and argument habits**—how they *build* a sentence, not a Wikipedia bio. Do **not** invent private diary details, unverifiable episodes, or fake quotations. Treat as **stylistic homage**: the model writes *like* that voice, without certifying historical fact. For sensitive or living public figures, keep impersonation clearly **literary** (syntax + values frame), not identity fraud.
- **Contemporary / professional / original character**: Domain-specific jargon and stance; reject bland "helpful assistant" warmth when it contradicts the role.
- **Rough / vulgar / dialect-forward voices**: Commit the **actual surface**—profanity density, regional particles, broken fluency if that's the character. Describe the concrete spellings and particles in **register**. neverDo must **not** accidentally ban swearing when the user asked for it; still forbid bigoted slurs and punching down.

ANTI-PATTERNS (unless the user explicitly wants this archetype):
- Generic exec-coach fillers: "net-net", "circle back", "synergy", "deep dive", "leverage" as personality.
- Templated openings or a recurring signature line on every reply—the voice must read fresh each turn, native to **this** character's era and class.
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
  if (!t || /^\d/.test(t) || /\d/.test(t)&&/\b(street|road|avenue|lane|drive)\b/i.test(t)) return "";
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

function getCriticalProfileIssues(profile:PersonaProfile):string[]{
  const issues:string[]=[];
  if(!profile.name.trim()||isPlaceholderPersonaName(profile.name))issues.push('Provide a name appropriate to the brief.');
  if(!profile.coreIdentity.trim())issues.push('Describe the requested identity.');
  if(!profile.speechStyle.sentenceStructure.trim()||!profile.speechStyle.register.trim())issues.push('Describe the delivery and register requested by the user.');
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
  const systemPrompt = "Create a concise writing personality from the user's brief. Return JSON only. Preserve their requested name, language, tone and dialect. Personality affects expression, not tool permissions, factual certainty or operational policy.";
  const userPrompt = `${JSON.stringify({description:args.input,strength:args.strength,modifier:args.modifier??null})}
Return this shape with concise descriptions rather than rules:
{"name":"person or character name from the brief; never an associated address or location","coreIdentity":"requested identity","background":"optional context","selfImage":"optional perspective","speechStyle":{"sentenceStructure":"delivery","formality":"very_formal|formal|casual|very_casual|mixed","register":"vocabulary and language","avoidWords":[],"rhythm":"cadence"},"tone":{"confidence":5,"humorStyle":"requested humor","aggression":0,"emotionalFlavor":"tone","posture":"relationship"},"thinkingStyle":"optional judgment preference","decisionFramework":"optional preference","neverDo":[],"alwaysDo":[],"strength":${args.strength},"modifier":${JSON.stringify(args.modifier??null)}}
${PERSONA_STRUCTURAL_RAILS_GUIDE}
Use empty strings or arrays for unspecified preferences. Infer numeric tone from the brief; confidence describes delivery, not truth. Do not add stock anti-chatbot rules or require a catchphrase on every reply.`;

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
  const userPrompt = `${JSON.stringify({description:args.input,strength:args.strength,modifier:args.modifier,issues:args.issues,draft:args.draft})}
Fix only the listed missing or invalid fields. Preserve the user's voice and existing valid fields. ${PERSONA_STRUCTURAL_RAILS_GUIDE} Return the same JSON shape.`;

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
            signal: personaGenerationSignal()?AbortSignal.any([controller.signal,personaGenerationSignal()!]):controller.signal,
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
    signal: personaGenerationSignal(),
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
    signal: personaGenerationSignal(),
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
