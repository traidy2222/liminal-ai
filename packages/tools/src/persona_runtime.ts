import type { AgentHarness } from "@liminal/core";
import type { PersonaArtifactId } from "@liminal/core/persona-bootstrap-progress";
import {
  migratePersonaUiTheme,
  personaActivePaths,
  sanitizePersonaUiCopy,
  DEFAULT_PERSONA_UI_COPY,
  type PersonaUiThemeV2,
  type PersonaUiCopy,
} from "@liminal/core";
import { existsSync } from "node:fs";
import type { RuntimePersonaControls } from "@liminal/core";
import { mkdir, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  buildHarnessCapabilitySummary,
  buildSoulSlicesFromProfile,
  generatePersonaBundle,
  generatePersonaSoulArtifacts,
  generatePersonaUiTheme,
  generatePersonaUiCopy,
  type PersonaGenerationBundle,
  type PersonaSoulBundle,
} from "./persona_generator.js";
import {
  PersonaGenerationPreview,
  personaGenerationStreamEnabled,
  type PersonaProgressFn,
} from "./persona_generation_preview.js";
import { writePersonaArtifact, writePersonaArtifactStreaming, finalizePersonaManifest } from "./persona_artifact_io.js";
import {
  buildPersonaTraitTags,
  buildPersonaVoiceSummary,
  buildRichPersonaBlock,
  type PersonaProfile,
} from "./persona_presets.js";

export interface ParsedPersonaInput {
  coreInput: string;
  strength: number;
  modifier?: string;
}

/** Max markdown appended in one `append_persona_living` call (body only; heading overhead separate). */
export const PERSONA_LIVING_MAX_APPEND_CHARS = 3500;

/** Max total size of `soul/living.md`; older head content is dropped when exceeded. */
export const PERSONA_LIVING_MAX_FILE_CHARS = 24_000;

const SOUL_SUBDIR = "soul";

const DEFAULT_LIVING_HEADER = [
  "# Persona living notes",
  "",
  "Harness-managed append-only entries. Use the **append_persona_living** tool for durable persona-local learnings here — raw `write_file` does not reload the harness persona block.",
  "",
].join("\n");

export interface PersonaArtifactsPaths {
  dir: string;
  soulDir: string;
  runtimeProfilePath: string;
  /** Obsolete monolithic file at `persona/active/soul.md` — deleted on load/persist (soul lives under `soul/`). */
  staleMonolithicSoulMd: string;
  identityPath: string;
  voicePath: string;
  stancePath: string;
  railsPath: string;
  livingPath: string;
  legacyLexiconPath: string;
  manifestPath: string;
  uiThemePath: string;
  uiCopyPath: string;
}

export function getPersonaArtifactsPaths(): PersonaArtifactsPaths {
  // Phase 1 storage split: persona lives under ~/.liminal/persona/active/ so
  // a single persona follows the user across all workspaces and chats.
  //
  // Fallback rule (defensive — earlier bugs let an empty global dir win over a
  // populated legacy one):
  //   - If AGENT_STORAGE_LAYOUT=legacy, always use legacy.
  //   - Else prefer global when it has a runtime_profile.json (i.e. real persona
  //     content lives there).
  //   - Else if legacy exists and looks populated, use legacy. First persona
  //     write under this resolver creates the global dir; once it has a runtime
  //     profile, subsequent reads stay on global.
  //   - Else use global (greenfield install with no persona yet).
  const paths = personaActivePaths();
  let dir: string;
  if (paths.legacyOnly) {
    dir = paths.legacy;
  } else if (existsSync(join(paths.global, "runtime_profile.json"))) {
    dir = paths.global;
  } else if (existsSync(join(paths.legacy, "runtime_profile.json"))) {
    dir = paths.legacy;
  } else {
    dir = paths.global;
  }
  const soulDir = join(dir, SOUL_SUBDIR);
  return {
    dir,
    soulDir,
    runtimeProfilePath: join(dir, "runtime_profile.json"),
    staleMonolithicSoulMd: join(dir, "soul.md"),
    identityPath: join(soulDir, "identity.md"),
    voicePath: join(soulDir, "voice.md"),
    stancePath: join(soulDir, "stance.md"),
    railsPath: join(soulDir, "rails.md"),
    livingPath: join(soulDir, "living.md"),
    legacyLexiconPath: join(dir, "style_lexicon.json"),
    manifestPath: join(dir, "manifest.json"),
    uiThemePath: join(dir, "ui_theme.json"),
    uiCopyPath: join(dir, "ui_copy.json"),
  };
}

export interface PersonaSoulDiskSlices {
  identity?: string;
  voice?: string;
  stance?: string;
  rails?: string;
  living?: string;
}

/**
 * Parse a persona input string for optional strength and modifier directives.
 */
export function parsePersonaInput(input: string): ParsedPersonaInput {
  let text = input.trim();
  let strength = 8;
  let modifier: string | undefined;

  const butMatch = text.match(/\s+but\s+(.+)$/i);
  if (butMatch) {
    modifier = butMatch[1].trim();
    text = text.slice(0, text.length - butMatch[0].length).trim();
  }

  const strengthExplicit = text.match(/\bstrength[:\s]+(\d{1,2})\b/i);
  if (strengthExplicit) {
    const n = parseInt(strengthExplicit[1], 10);
    if (n >= 1 && n <= 10) strength = n;
    text = text.replace(strengthExplicit[0], "").trim();
  } else {
    const trailingDigit = text.match(/\s+([1-9]|10)$/);
    if (trailingDigit) {
      strength = parseInt(trailingDigit[1], 10);
      text = text.slice(0, text.length - trailingDigit[0].length).trim();
    }
  }

  return { coreInput: text, strength, modifier };
}

export function isResetToDefaultRequest(coreInput: string): boolean {
  const k = coreInput.toLowerCase().trim();
  return k === "default" || k === "liminal" || k === "reset" || k === "clear";
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** Removes obsolete `persona/active/soul.md` if present — canonical soul is only under `soul/*.md`. */
async function removeStaleMonolithicSoulMd(paths: PersonaArtifactsPaths): Promise<void> {
  await unlink(paths.staleMonolithicSoulMd).catch(() => undefined);
}

async function readOptionalSlice(p: string): Promise<string | undefined> {
  const t = (await readFile(p, "utf8").catch(() => "")).trim();
  return t || undefined;
}

export async function loadPersonaArtifactsContext(): Promise<PersonaSoulDiskSlices> {
  try {
    const paths = getPersonaArtifactsPaths();
    await removeStaleMonolithicSoulMd(paths);
    const [identity, voice, stance, rails, living] = await Promise.all([
      readOptionalSlice(paths.identityPath),
      readOptionalSlice(paths.voicePath),
      readOptionalSlice(paths.stancePath),
      readOptionalSlice(paths.railsPath),
      readOptionalSlice(paths.livingPath),
    ]);
    return { identity, voice, stance, rails, living };
  } catch {
    return {};
  }
}

function soulDelimiter(label: string): string {
  return `\n\n<!-- === persona/soul:${label} === -->\n\n`;
}

/**
 * Ordered markdown for canonical soul files + living notes (used when applying persona to harness).
 */
export function buildPersonaSoulMarkdownFromSlices(slices: PersonaSoulDiskSlices): string | undefined {
  const parts: string[] = [];
  if (slices.identity?.trim()) {
    parts.push(soulDelimiter("identity"), slices.identity.trim());
  }
  if (slices.voice?.trim()) {
    parts.push(soulDelimiter("voice"), slices.voice.trim());
  }
  if (slices.stance?.trim()) {
    parts.push(soulDelimiter("stance"), slices.stance.trim());
  }
  if (slices.rails?.trim()) {
    parts.push(soulDelimiter("rails"), slices.rails.trim());
  }
  if (slices.living?.trim()) {
    parts.push(
      soulDelimiter("living"),
      "## PERSONA LIVING NOTES (active operating corrections — apply now)",
      "",
      "_These notes record what actually worked or failed in practice. Where a living note addresses the same dimension as a soul slice above, the living note takes precedence — it is a correction, not a suggestion._",
      "",
      slices.living.trim()
    );
  }
  const joined = parts.join("\n").trim();
  return joined || undefined;
}

async function persistPersonaArtifacts(
  sourcePrompt: string,
  profile: PersonaProfile,
  bundle: PersonaSoulBundle,
  controls: RuntimePersonaControls
): Promise<void> {
  await writePersonaArtifact("runtime_profile", JSON.stringify(profile, null, 2));
  await writePersonaArtifact("soul_identity", bundle.identityMd);
  await writePersonaArtifact("soul_voice", bundle.voiceMd);
  await writePersonaArtifact("soul_stance", bundle.stanceMd);
  await writePersonaArtifact("soul_rails", bundle.railsMd);
  await finalizePersonaManifest({ sourcePrompt, profile, controls });
}

export async function clearPersistedPersonaArtifacts(): Promise<void> {
  const paths = getPersonaArtifactsPaths();
  await rm(paths.dir, { recursive: true, force: true });
}

export async function generatePersonaFromInput(
  harness: AgentHarness,
  coreInput: string,
  strength: number,
  modifier?: string,
  onProgress?: PersonaProgressFn
): Promise<PersonaGenerationBundle> {
  const { openRouterApiKey, model, baseURL } = harness.config;
  const capabilitySummary = buildHarnessCapabilitySummary(
    harness.registry.getAll().map((t) => t.name)
  );
  const harnessCapabilityHint = capabilitySummary || undefined;

  const streamArtifacts = personaGenerationStreamEnabled() && Boolean(onProgress);
  const preview = streamArtifacts
    ? new PersonaGenerationPreview(
        (stage, message, detail) => {
          if (detail?.artifacts?.length) {
            for (const a of detail.artifacts) {
              if (a.status === "streaming" && a.content) {
                void writePersonaArtifactStreaming(a.id, a.content).catch(() => undefined);
              }
            }
          }
          onProgress?.(stage, message, detail);
        },
        async (id, content) => {
          await writePersonaArtifact(id, content);
        }
      )
    : undefined;
  const progress: PersonaProgressFn | undefined = preview
    ? (stage, message) => preview.emit(stage, message)
    : onProgress;

  progress?.("profile_start", "Starting persona profile generation...");
  const bundle = await generatePersonaBundle(
    coreInput,
    strength,
    modifier,
    openRouterApiKey,
    model,
    baseURL,
    progress,
    preview,
    harnessCapabilityHint
  );
  const profile = bundle.profile;
  const scaffold = buildSoulSlicesFromProfile(profile, coreInput);
  progress?.("artifact_start", "Generating soul blueprint and HUD theme…");
  const [soulBundle, uiTheme] = await Promise.all([
    generatePersonaSoulArtifacts(
      profile,
      coreInput,
      openRouterApiKey,
      model,
      baseURL,
      progress,
      { scaffold, preview, harnessCapabilityHint }
    ),
    generatePersonaUiTheme(profile, scaffold, openRouterApiKey, model, baseURL, preview),
  ]).catch((err: unknown) => {
    console.error("[persona] soul/theme generation failed:", err);
    throw err;
  });

  // In-voice interface microcopy (best-effort; falls back to defaults). Runs
  // after soul so it can draw on the finished voice excerpt.
  progress?.("ui_copy_start", "Writing interface copy in voice…");
  const uiCopy = await generatePersonaUiCopy(
    profile,
    soulBundle,
    openRouterApiKey,
    model,
    baseURL,
    preview
  ).catch(() => DEFAULT_PERSONA_UI_COPY);

  if (streamArtifacts && preview) {
    progress?.("artifact_manifest", "Writing manifest and living notes…");
    await finalizePersonaManifest({
      sourcePrompt: coreInput,
      profile,
      controls: bundle.defaultControls,
    });
    if (harnessCapabilityHint) {
      await appendPersonaLivingSection(
        `**Operating context at persona creation**\n\nCapability domains: ${harnessCapabilityHint}.`
      ).catch(() => undefined);
    }
    await writeFile(
      getPersonaArtifactsPaths().uiCopyPath,
      JSON.stringify(uiCopy, null, 2),
      "utf8"
    ).catch(() => undefined);
    progress?.("artifact_ready", "Persona artifacts ready.");
    progress?.("ui_theme_ready", "HUD theme saved.");
    return bundle;
  }

  progress?.("artifact_persist", "Writing persona artifacts to workspace...");
  await persistPersonaArtifacts(coreInput, profile, soulBundle, bundle.defaultControls);
  const paths = getPersonaArtifactsPaths();
  await writeFile(paths.uiThemePath, JSON.stringify(uiTheme, null, 2), "utf8");
  await writeFile(paths.uiCopyPath, JSON.stringify(uiCopy, null, 2), "utf8").catch(() => undefined);
  if (harnessCapabilityHint) {
    await appendPersonaLivingSection(
      `**Operating context at persona creation**\n\nCapability domains: ${harnessCapabilityHint}.`
    ).catch(() => undefined);
  }
  progress?.("artifact_ready", "Persona artifacts ready.");
  progress?.("ui_theme_ready", "HUD theme saved.");
  return bundle;
}

/**
 * Load `runtime_profile.json` from workspace when present (fallback when prefs lack activeProfile).
 */
export async function loadPersonaProfileFromWorkspace(): Promise<PersonaProfile | null> {
  try {
    const paths = getPersonaArtifactsPaths();
    const raw = await readFile(paths.runtimeProfilePath, "utf8");
    return JSON.parse(raw) as PersonaProfile;
  } catch {
    return null;
  }
}

/**
 * Load normalized persona UI theme from `persona/active/ui_theme.json` if present.
 */
export async function loadPersonaUiThemeFromWorkspace(): Promise<PersonaUiThemeV2 | null> {
  try {
    const paths = getPersonaArtifactsPaths();
    const raw = await readFile(paths.uiThemePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return migratePersonaUiTheme(parsed);
  } catch {
    return null;
  }
}

/**
 * Load sanitized persona UI copy from `persona/active/ui_copy.json` if present.
 * Returns null when absent (callers fall back to {@link DEFAULT_PERSONA_UI_COPY}).
 */
export async function loadPersonaUiCopyFromWorkspace(): Promise<PersonaUiCopy | null> {
  try {
    const paths = getPersonaArtifactsPaths();
    const raw = await readFile(paths.uiCopyPath, "utf8");
    return sanitizePersonaUiCopy(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function applyPersonaProfileToHarness(harness: AgentHarness, profile: PersonaProfile): Promise<void> {
  const slices = await loadPersonaArtifactsContext();
  const soulMd = buildPersonaSoulMarkdownFromSlices(slices);
  const parts = [buildRichPersonaBlock(profile)];
  if (soulMd) {
    parts.push("", "SOUL BLUEPRINT (authoritative identity reference):", soulMd);
  }
  const block = parts.join("\n");
  harness.setPersona(
    {
      name: profile.name,
      description: profile.coreIdentity,
      voice: buildPersonaVoiceSummary(profile),
      traits: buildPersonaTraitTags(profile),
    },
    block
  );
}

export interface AppendPersonaLivingResult {
  ok: boolean;
  error?: string;
  appendedChars?: number;
  fileCharsAfter?: number;
  trimmedHead?: boolean;
}

/**
 * Append a bounded section to `soul/living.md` and trim head when over {@link PERSONA_LIVING_MAX_FILE_CHARS}.
 */
export async function appendPersonaLivingSection(body: string): Promise<AppendPersonaLivingResult> {
  const trimmed = body.replace(/\r/g, "").trim();
  if (!trimmed) return { ok: false, error: "note body is empty after trim" };
  if (trimmed.length > PERSONA_LIVING_MAX_APPEND_CHARS) {
    return {
      ok: false,
      error: `note exceeds max length (${PERSONA_LIVING_MAX_APPEND_CHARS} chars); shorten and retry`,
    };
  }
  const paths = getPersonaArtifactsPaths();
  await mkdir(paths.soulDir, { recursive: true });
  await removeStaleMonolithicSoulMd(paths);

  if (!(await fileExists(paths.identityPath))) {
    return {
      ok: false,
      error: "persona soul files missing — run set_persona to generate persona artifacts first",
    };
  }

  let existing = (await readFile(paths.livingPath, "utf8").catch(() => "")).trim();
  if (!existing) existing = DEFAULT_LIVING_HEADER;

  const stamp = new Date().toISOString();
  const section = `\n\n### ${stamp}\n\n${trimmed}\n`;
  let next = `${existing}${section}`;
  let trimmedHead = false;
  if (next.length > PERSONA_LIVING_MAX_FILE_CHARS) {
    trimmedHead = true;
    const overflow = next.length - PERSONA_LIVING_MAX_FILE_CHARS;
    next = next.slice(overflow);
    if (!next.includes("### ")) {
      next = `${DEFAULT_LIVING_HEADER}\n\n_(Earlier living notes trimmed for size.)_\n${next}`;
    }
  }
  await writeFile(paths.livingPath, next + "\n", "utf8");
  return {
    ok: true,
    appendedChars: trimmed.length,
    fileCharsAfter: next.length,
    trimmedHead,
  };
}
