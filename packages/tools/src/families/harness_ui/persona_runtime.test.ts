import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentHarness } from "@liminal/core";
import type { PersonaProfile } from "./persona_presets.js";
import { createAppendPersonaLivingTool } from "./append_persona_living.js";

let prevWorkspace: string | undefined;
let prevGlobalRoot: string | undefined;

beforeEach(() => {
  prevWorkspace = process.env.AGENT_WORKSPACE_ROOT;
  prevGlobalRoot = process.env.AGENT_GLOBAL_STORAGE_ROOT;
});

afterEach(async () => {
  if (prevWorkspace === undefined) delete process.env.AGENT_WORKSPACE_ROOT;
  else process.env.AGENT_WORKSPACE_ROOT = prevWorkspace;
  if (prevGlobalRoot === undefined) delete process.env.AGENT_GLOBAL_STORAGE_ROOT;
  else process.env.AGENT_GLOBAL_STORAGE_ROOT = prevGlobalRoot;
});

const minimalProfile: PersonaProfile = {
  name: "Test Voice",
  coreIdentity: "A concise test identity for harness block assembly and soul reload wiring.",
  background: "Grounding line one. Grounding line two for tests.",
  selfImage: "Sees itself as careful and precise under uncertainty.",
  speechStyle: {
    sentenceStructure: "Short leads; bullets for lists.",
    formality: "casual",
    register: "Plain technical diction — constraints, tradeoffs, signal; maps-and-weights imagery; steady and direct.",
    avoidWords: ["delve", "synergy", "happy to help", "leverage"],
    rhythm: "Staccato opens, tight closes.",
  },
  tone: {
    confidence: 6,
    humorStyle: "Dry",
    aggression: 3,
    emotionalFlavor: "focused",
    posture: "Collaborative, direct.",
  },
  thinkingStyle: "Prefers explicit assumptions and falsifiable checks when diagnosing.",
  decisionFramework: "Maps risk and reversibility before committing to a path.",
  neverDo: ["Use asterisk actions", "Write theatrical monologues", "Invent specifics"],
  alwaysDo: [
    "Stay accurate with facts: label guesses",
    "Name inference boundaries",
    "Ask when underspecified",
  ],
  strength: 7,
};

test("loadPersonaArtifactsContext removes stale monolithic soul.md", async () => {
  const root = await mkdtemp(join(tmpdir(), "lim-persona-"));
  // Phase 1 storage split: persona now lives under ~/.liminal/persona/active/.
  // Tests MUST isolate AGENT_GLOBAL_STORAGE_ROOT to the test tmpdir or they will
  // clobber the real user's persona profile in their home dir.
  process.env.AGENT_WORKSPACE_ROOT = root;
  process.env.AGENT_GLOBAL_STORAGE_ROOT = root;
  const { getPersonaArtifactsPaths, loadPersonaArtifactsContext } = await import("./persona_runtime.js");
  const paths = getPersonaArtifactsPaths();
  await mkdir(paths.dir, { recursive: true });
  await mkdir(paths.soulDir, { recursive: true });
  await writeFile(paths.staleMonolithicSoulMd, "# old monolith\n", "utf8");
  await writeFile(paths.identityPath, "# Identity Core\n\nok\n", "utf8");
  await loadPersonaArtifactsContext();
  await assert.rejects(async () => readFile(paths.staleMonolithicSoulMd, "utf8"));
  await rm(root, { recursive: true, force: true });
});

test("buildPersonaSoulMarkdownFromSlices orders living after canonical slices", async () => {
  const { buildPersonaSoulMarkdownFromSlices } = await import("./persona_runtime.js");
  const md = buildPersonaSoulMarkdownFromSlices({
    identity: "# Identity Core\nA",
    voice: "# Voice DNA\nB",
    stance: "# Cognitive stance\nC",
    rails: "# Behavioral rails\nD",
    living: "tail-note",
  })!;
  const idxLiving = md.indexOf("PERSONA LIVING NOTES");
  const idxRails = md.indexOf("# Behavioral rails");
  const idxIdentity = md.indexOf("# Identity Core");
  assert.ok(idxIdentity >= 0 && idxRails >= 0 && idxLiving >= 0);
  assert.ok(idxIdentity < idxRails && idxRails < idxLiving);
  assert.match(md, /tail-note/);
});

test("appendPersonaLivingSection rejects oversized notes", async () => {
  const root = await mkdtemp(join(tmpdir(), "lim-persona-"));
  // Phase 1 storage split: persona now lives under ~/.liminal/persona/active/.
  // Tests MUST isolate AGENT_GLOBAL_STORAGE_ROOT to the test tmpdir or they will
  // clobber the real user's persona profile in their home dir.
  process.env.AGENT_WORKSPACE_ROOT = root;
  process.env.AGENT_GLOBAL_STORAGE_ROOT = root;
  const mod = await import("./persona_runtime.js");
  const paths = mod.getPersonaArtifactsPaths();
  await mkdir(paths.soulDir, { recursive: true });
  await writeFile(paths.identityPath, "# Identity Core\n\nx\n", "utf8");
  const big = "a".repeat(mod.PERSONA_LIVING_MAX_APPEND_CHARS + 10);
  const r = await mod.appendPersonaLivingSection(big);
  assert.equal(r.ok, false);
  assert.match(String(r.error), /max length/i);
});

test("appendPersonaLivingSection eventually trims head when over file cap", async () => {
  const root = await mkdtemp(join(tmpdir(), "lim-persona-"));
  // Phase 1 storage split: persona now lives under ~/.liminal/persona/active/.
  // Tests MUST isolate AGENT_GLOBAL_STORAGE_ROOT to the test tmpdir or they will
  // clobber the real user's persona profile in their home dir.
  process.env.AGENT_WORKSPACE_ROOT = root;
  process.env.AGENT_GLOBAL_STORAGE_ROOT = root;
  const mod = await import("./persona_runtime.js");
  const paths = mod.getPersonaArtifactsPaths();
  await mkdir(paths.soulDir, { recursive: true });
  await writeFile(paths.identityPath, "# Identity Core\n\nx\n", "utf8");
  let sawTrim = false;
  for (let i = 0; i < 120; i++) {
    const chunk = `${"b".repeat(800)}MARK_${i}\n`;
    const r = await mod.appendPersonaLivingSection(chunk);
    assert.equal(r.ok, true);
    if (r.trimmedHead) {
      sawTrim = true;
      break;
    }
  }
  assert.equal(sawTrim, true);
  const final = await readFile(paths.livingPath, "utf8");
  assert.ok(final.length <= mod.PERSONA_LIVING_MAX_FILE_CHARS + 800);
});

test("applyPersonaProfileToHarness includes living slice in persona block", async () => {
  const root = await mkdtemp(join(tmpdir(), "lim-persona-"));
  // Phase 1 storage split: persona now lives under ~/.liminal/persona/active/.
  // Tests MUST isolate AGENT_GLOBAL_STORAGE_ROOT to the test tmpdir or they will
  // clobber the real user's persona profile in their home dir.
  process.env.AGENT_WORKSPACE_ROOT = root;
  process.env.AGENT_GLOBAL_STORAGE_ROOT = root;
  const rt = await import("./persona_runtime.js");
  const paths = rt.getPersonaArtifactsPaths();
  await mkdir(paths.soulDir, { recursive: true });
  await writeFile(paths.identityPath, "# Identity Core\nid\n", "utf8");
  await writeFile(paths.livingPath, "# Persona living notes\n\nhello-living\n", "utf8");
  let block = "";
  const harness = {
    setPersona(_cfg: unknown, b: string) {
      block = b;
    },
  } as unknown as AgentHarness;
  await rt.applyPersonaProfileToHarness(harness, minimalProfile);
  assert.match(block, /PERSONA LIVING NOTES/);
  assert.match(block, /hello-living/);
});

test("append_persona_living tool reloads harness via setPersona", async () => {
  const root = await mkdtemp(join(tmpdir(), "lim-persona-"));
  // Phase 1 storage split: persona now lives under ~/.liminal/persona/active/.
  // Tests MUST isolate AGENT_GLOBAL_STORAGE_ROOT to the test tmpdir or they will
  // clobber the real user's persona profile in their home dir.
  process.env.AGENT_WORKSPACE_ROOT = root;
  process.env.AGENT_GLOBAL_STORAGE_ROOT = root;
  const rt = await import("./persona_runtime.js");
  const paths = rt.getPersonaArtifactsPaths();
  await mkdir(paths.soulDir, { recursive: true });
  await writeFile(paths.identityPath, "# Identity Core\n\nid\n", "utf8");
  await writeFile(paths.runtimeProfilePath, JSON.stringify(minimalProfile), "utf8");
  await writeFile(paths.livingPath, "# Persona living notes\n\nseed\n", "utf8");

  let blocks: string[] = [];
  const harness = {
    getPersistedPersonaProfile: () => undefined,
    setPersona(_cfg: unknown, b: string) {
      blocks.push(b);
    },
  } as unknown as AgentHarness;

  const tool = createAppendPersonaLivingTool(harness);
  const out = (await tool.handler({ note: "new-lesson" })) as { ok?: boolean; output?: string };
  assert.equal(out.ok, true);
  assert.match(out.output ?? "", /reloaded/i);
  assert.ok(blocks.length >= 1);
  assert.match(blocks[blocks.length - 1]!, /new-lesson/);
  await rm(root, { recursive: true, force: true });
});
