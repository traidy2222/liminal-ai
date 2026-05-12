import type { AgentHarness } from "@liminal/core";
import { resolveWorkspaceRoot } from "@liminal/core";
import type { RuntimePersonaControls } from "@liminal/core";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  generatePersonaBundle,
  generatePersonaSoulArtifacts,
  type PersonaProgressFn,
  type PersonaGenerationBundle,
  type PersonaSoulArtifacts,
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

const PERSONA_ACTIVE_DIR = ["persona", "active"];

function getPersonaArtifactsPaths() {
  const root = resolveWorkspaceRoot();
  const dir = join(root, ...PERSONA_ACTIVE_DIR);
  return {
    dir,
    runtimeProfilePath: join(dir, "runtime_profile.json"),
    soulPath: join(dir, "soul.md"),
    lexiconPath: join(dir, "style_lexicon.json"),
    manifestPath: join(dir, "manifest.json"),
  };
}

async function persistPersonaArtifacts(
  sourcePrompt: string,
  profile: PersonaProfile,
  artifacts: PersonaSoulArtifacts,
  controls: RuntimePersonaControls
): Promise<void> {
  const paths = getPersonaArtifactsPaths();
  await mkdir(paths.dir, { recursive: true });
  await writeFile(paths.runtimeProfilePath, JSON.stringify(profile, null, 2), "utf8");
  await writeFile(paths.soulPath, artifacts.soulMarkdown.trim() + "\n", "utf8");
  await writeFile(paths.lexiconPath, JSON.stringify(artifacts.styleLexicon, null, 2), "utf8");
  await writeFile(
    paths.manifestPath,
    JSON.stringify(
      {
        version: 1,
        updatedAt: Date.now(),
        sourcePrompt,
        name: profile.name,
        controls,
        files: {
          runtimeProfile: "runtime_profile.json",
          soul: "soul.md",
          styleLexicon: "style_lexicon.json",
        },
      },
      null,
      2
    ),
    "utf8"
  );
}

async function loadPersonaArtifactsContext(): Promise<{ soulMarkdown?: string; styleLexiconJson?: string }> {
  try {
    const paths = getPersonaArtifactsPaths();
    const [soulRaw, lexiconRaw] = await Promise.all([
      readFile(paths.soulPath, "utf8").catch(() => ""),
      readFile(paths.lexiconPath, "utf8").catch(() => ""),
    ]);
    return {
      soulMarkdown: soulRaw.trim() || undefined,
      styleLexiconJson: lexiconRaw.trim() || undefined,
    };
  } catch {
    return {};
  }
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
  onProgress?.("artifact_start", "Starting soul and lexicon generation...");
  const artifacts = await generatePersonaSoulArtifacts(
    profile,
    coreInput,
    openRouterApiKey,
    model,
    baseURL,
    onProgress
  );
  onProgress?.("artifact_persist", "Writing persona artifacts to workspace...");
  await persistPersonaArtifacts(coreInput, profile, artifacts, bundle.defaultControls);
  onProgress?.("artifact_ready", "Persona artifacts ready.");
  return bundle;
}

export async function applyPersonaProfileToHarness(
  harness: AgentHarness,
  profile: PersonaProfile
): Promise<void> {
  const extra = await loadPersonaArtifactsContext();
  const parts = [buildRichPersonaBlock(profile)];
  if (extra.soulMarkdown) {
    parts.push(
      "",
      "SOUL BLUEPRINT (authoritative identity reference):",
      extra.soulMarkdown
    );
  }
  if (extra.styleLexiconJson) {
    parts.push(
      "",
      "STYLE LEXICON (json reference):",
      extra.styleLexiconJson
    );
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

