import type { AgentHarness } from "@liminal/core";
import { resolveWorkspaceRoot, validateAndNormalizePersonaUiTheme, type PersonaUiThemeV1 } from "@liminal/core";
import type { RuntimePersonaControls } from "@liminal/core";
import { mkdir, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  generatePersonaBundle,
  generatePersonaSoulArtifacts,
  generatePersonaUiTheme,
  type PersonaProgressFn,
  type PersonaGenerationBundle,
  type PersonaSoulBundle,
} from "./persona_generator.js";
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

const PERSONA_ACTIVE_DIR = ["persona", "active"] as const;
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
}

export function getPersonaArtifactsPaths(): PersonaArtifactsPaths {
  const root = resolveWorkspaceRoot();
  const dir = join(root, ...PERSONA_ACTIVE_DIR);
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
      "## PERSONA LIVING NOTES (session-accumulated; non-canonical)",
      "",
      "_Supplemental voice lessons and persona-local habits — less authoritative than identity/voice slices above._",
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
  const paths = getPersonaArtifactsPaths();
  await mkdir(paths.soulDir, { recursive: true });
  await removeStaleMonolithicSoulMd(paths);

  let livingContent = (await readFile(paths.livingPath, "utf8").catch(() => "")).trim();
  if (!livingContent) livingContent = DEFAULT_LIVING_HEADER;

  await writeFile(paths.runtimeProfilePath, JSON.stringify(profile, null, 2), "utf8");
  await writeFile(paths.identityPath, bundle.identityMd.trim() + "\n", "utf8");
  await writeFile(paths.voicePath, bundle.voiceMd.trim() + "\n", "utf8");
  await writeFile(paths.stancePath, bundle.stanceMd.trim() + "\n", "utf8");
  await writeFile(paths.railsPath, bundle.railsMd.trim() + "\n", "utf8");
  await writeFile(paths.livingPath, livingContent + "\n", "utf8");

  await unlink(paths.legacyLexiconPath).catch(() => undefined);
  await writeFile(
    paths.manifestPath,
    JSON.stringify(
      {
        version: 2,
        updatedAt: Date.now(),
        sourcePrompt,
        name: profile.name,
        controls,
        files: {
          runtimeProfile: "runtime_profile.json",
          soulIdentity: "soul/identity.md",
          soulVoice: "soul/voice.md",
          soulStance: "soul/stance.md",
          soulRails: "soul/rails.md",
          soulLiving: "soul/living.md",
          uiTheme: "ui_theme.json",
        },
      },
      null,
      2
    ),
    "utf8"
  );
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
  onProgress?.("profile_start", "Starting persona profile generation...");
  const bundle = await generatePersonaBundle(
    coreInput,
    strength,
    modifier,
    openRouterApiKey,
    model,
    baseURL,
    onProgress
  );
  const profile = bundle.profile;
  onProgress?.("artifact_start", "Generating soul blueprint…");
  const soulBundle = await generatePersonaSoulArtifacts(
    profile,
    coreInput,
    openRouterApiKey,
    model,
    baseURL,
    onProgress
  );
  onProgress?.("artifact_persist", "Writing persona artifacts to workspace...");
  await persistPersonaArtifacts(coreInput, profile, soulBundle, bundle.defaultControls);
  onProgress?.("artifact_ready", "Persona artifacts ready.");
  onProgress?.("ui_theme_start", "Designing HUD colors and motion…");
  const uiTheme = await generatePersonaUiTheme(profile, soulBundle, openRouterApiKey, model, baseURL);
  const paths = getPersonaArtifactsPaths();
  await writeFile(paths.uiThemePath, JSON.stringify(uiTheme, null, 2), "utf8");
  try {
    const manRaw = await readFile(paths.manifestPath, "utf8");
    const man = JSON.parse(manRaw) as Record<string, unknown>;
    const files =
      man["files"] && typeof man["files"] === "object"
        ? (man["files"] as Record<string, string>)
        : {};
    man["files"] = { ...files, uiTheme: "ui_theme.json" };
    await writeFile(paths.manifestPath, JSON.stringify(man, null, 2), "utf8");
  } catch {
    /* ignore manifest patch */
  }
  onProgress?.("ui_theme_ready", "HUD theme saved.");
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
export async function loadPersonaUiThemeFromWorkspace(): Promise<PersonaUiThemeV1 | null> {
  try {
    const paths = getPersonaArtifactsPaths();
    const raw = await readFile(paths.uiThemePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return validateAndNormalizePersonaUiTheme(parsed);
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
