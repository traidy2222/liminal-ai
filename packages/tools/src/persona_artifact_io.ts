import type { PersonaArtifactId } from "@liminal/core/persona-bootstrap-progress";
import { resolveWorkspaceRoot } from "@liminal/core";
import type { RuntimePersonaControls } from "@liminal/core";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PersonaProfile } from "./persona_presets.js";

const PERSONA_ACTIVE_DIR = ["persona", "active"] as const;
const SOUL_SUBDIR = "soul";

const DEFAULT_LIVING_HEADER = [
  "# Persona living notes",
  "",
  "Harness-managed append-only entries. Use the **append_persona_living** tool for durable persona-local learnings here — raw `write_file` does not reload the harness persona block.",
  "",
].join("\n");

const DEBOUNCE_MS = 2000;
const lastStreamWriteAt = new Map<PersonaArtifactId, number>();

function artifactPaths() {
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

/** Debounced disk write while an artifact is still streaming. */
export async function writePersonaArtifactStreaming(
  id: PersonaArtifactId,
  content: string
): Promise<void> {
  const now = Date.now();
  if (now - (lastStreamWriteAt.get(id) ?? 0) < DEBOUNCE_MS) return;
  lastStreamWriteAt.set(id, now);
  await writePersonaArtifact(id, content, { streaming: true });
}

export async function writePersonaArtifact(
  id: PersonaArtifactId,
  content: string,
  opts?: { streaming?: boolean }
): Promise<void> {
  const paths = artifactPaths();
  await mkdir(paths.soulDir, { recursive: true });
  await unlink(paths.staleMonolithicSoulMd).catch(() => undefined);

  switch (id) {
    case "runtime_profile":
      await writeFile(paths.runtimeProfilePath, content, "utf8");
      break;
    case "soul_identity":
      await writeFile(paths.identityPath, content.trimEnd() + "\n", "utf8");
      break;
    case "soul_voice":
      await writeFile(paths.voicePath, content.trimEnd() + "\n", "utf8");
      break;
    case "soul_stance":
      await writeFile(paths.stancePath, content.trimEnd() + "\n", "utf8");
      break;
    case "soul_rails":
      await writeFile(paths.railsPath, content.trimEnd() + "\n", "utf8");
      break;
    case "ui_theme":
      await writeFile(paths.uiThemePath, content, "utf8");
      break;
    default:
      break;
  }
  if (!opts?.streaming) {
    lastStreamWriteAt.delete(id);
  }
}

export async function finalizePersonaManifest(args: {
  sourcePrompt: string;
  profile: PersonaProfile;
  controls: RuntimePersonaControls;
}): Promise<void> {
  const paths = artifactPaths();
  await mkdir(paths.soulDir, { recursive: true });

  let livingContent = (await readFile(paths.livingPath, "utf8").catch(() => "")).trim();
  if (!livingContent) livingContent = DEFAULT_LIVING_HEADER;
  await writeFile(paths.livingPath, livingContent + "\n", "utf8");

  await unlink(paths.legacyLexiconPath).catch(() => undefined);
  await writeFile(
    paths.manifestPath,
    JSON.stringify(
      {
        version: 2,
        uiThemeVersion: 2,
        updatedAt: Date.now(),
        sourcePrompt: args.sourcePrompt,
        name: args.profile.name,
        controls: args.controls,
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
