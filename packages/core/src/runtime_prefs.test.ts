import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getRuntimePrefsPath,
  loadRuntimePreferences,
  saveRuntimePreferences,
  type RuntimePreferences,
} from "./runtime_prefs.js";

test("runtime prefs save/load roundtrip", async () => {
  const dir = await mkdtemp(join(tmpdir(), "liminal-prefs-"));
  const prefs: RuntimePreferences = {
    version: 1,
    provider: {
      model: "qwen/qwen3.5-9b",
      baseURL: "http://localhost:1234/v1",
    },
    runtime: { uiVerbosity: "quiet", rateLimitMaxRetries: 42 },
    updatedAt: Date.now(),
  };
  const path = await saveRuntimePreferences(prefs, dir);
  assert.equal(path, getRuntimePrefsPath(dir));
  const loaded = await loadRuntimePreferences(dir);
  assert.equal(loaded?.version, 1);
  assert.equal(loaded?.provider?.model, "qwen/qwen3.5-9b");
  assert.equal(loaded?.runtime?.uiVerbosity, "quiet");
  await rm(dir, { recursive: true, force: true });
});

test("runtime prefs preserve runtime control fields", async () => {
  const dir = await mkdtemp(join(tmpdir(), "liminal-prefs-"));
  const prefs: RuntimePreferences = {
    version: 1,
    runtime: {
      uiVerbosity: "quiet",
      approvalTimeoutMs: 120_000,
      destructiveGate: "balanced",
      rateLimitMaxRetries: 100,
      transient5xxMaxRetries: 50,
      retryMaxDelayMs: 240_000,
    },
    updatedAt: Date.now(),
  };
  await saveRuntimePreferences(prefs, dir);
  const loaded = await loadRuntimePreferences(dir);
  assert.equal(loaded?.runtime?.destructiveGate, "balanced");
  assert.equal(loaded?.runtime?.approvalTimeoutMs, 120_000);
  assert.equal(loaded?.runtime?.retryMaxDelayMs, 240_000);
  await rm(dir, { recursive: true, force: true });
});

test("runtime prefs loader ignores invalid version payload", async () => {
  const dir = await mkdtemp(join(tmpdir(), "liminal-prefs-"));
  const path = getRuntimePrefsPath(dir);
  await writeFile(path, JSON.stringify({ version: 2, updatedAt: Date.now() }), "utf8");
  const loaded = await loadRuntimePreferences(dir);
  assert.equal(loaded, null);
  await rm(dir, { recursive: true, force: true });
});

test("runtime prefs persist persona bootstrap state and profile", async () => {
  const dir = await mkdtemp(join(tmpdir(), "liminal-prefs-"));
  const prefs: RuntimePreferences = {
    version: 1,
    persona: {
      bootstrapCompleted: true,
      sourcePrompt: "Like JARVIS with terse engineering focus",
      activeProfile: {
        name: "Jarvis-Style",
        coreIdentity: "A precise technical advisor with dry confidence.",
        background: "Built for operational clarity under pressure.",
        selfImage: "Calm, exact, and quietly assertive.",
        speechStyle: {
          sentenceStructure: "Short lead, then direct details.",
          formality: "formal",
          favoriteWords: ["precisely", "noted"],
          avoidWords: ["happy to help"],
          commonMetaphors: ["control surface"],
          rhythm: "Measured with crisp endings.",
        },
        tone: {
          confidence: 8,
          humorStyle: "dry understatement",
          aggression: 2,
          emotionalFlavor: "calm steel",
          posture: "Loyal advisor who warns early.",
        },
        catchphrases: ["If I may.", "Recommendation follows."],
        verbalTics: ["Leads with one framing line before detail."],
        thinkingStyle: "Prioritizes failure modes before elegance.",
        decisionFramework: "Choose the safest effective path first.",
        neverDo: ["Use asterisk actions (*does thing*)"],
        alwaysDo: ["Complete the task accurately regardless of persona strength"],
        strength: 8,
      },
      updatedAt: Date.now(),
    },
    updatedAt: Date.now(),
  };
  await saveRuntimePreferences(prefs, dir);
  const loaded = await loadRuntimePreferences(dir);
  assert.equal(loaded?.persona?.bootstrapCompleted, true);
  assert.equal(loaded?.persona?.activeProfile?.name, "Jarvis-Style");
  assert.equal(loaded?.persona?.activeProfile?.speechStyle.formality, "formal");
  await rm(dir, { recursive: true, force: true });
});

test("runtime prefs preserve cleared persona profile marker", async () => {
  const dir = await mkdtemp(join(tmpdir(), "liminal-prefs-"));
  const prefs: RuntimePreferences = {
    version: 1,
    persona: {
      bootstrapCompleted: true,
      sourcePrompt: "default",
      activeProfile: null,
      controls: {
        humorPercent: 23,
        formality: "formal",
        confidence: 8,
        verbosity: "compact",
        personaStrength: 6,
      },
      updatedAt: Date.now(),
    },
    updatedAt: Date.now(),
  };
  await saveRuntimePreferences(prefs, dir);
  const loaded = await loadRuntimePreferences(dir);
  assert.equal(loaded?.persona?.activeProfile, null);
  assert.equal(loaded?.persona?.controls?.humorPercent, 23);
  assert.equal(loaded?.persona?.controls?.verbosity, "compact");
  await rm(dir, { recursive: true, force: true });
});

