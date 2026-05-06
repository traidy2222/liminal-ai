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
    provider: { model: "openrouter/owl-alpha", baseURL: "https://openrouter.ai/api/v1" },
    runtime: { uiVerbosity: "quiet", rateLimitMaxRetries: 42 },
    updatedAt: Date.now(),
  };
  const path = await saveRuntimePreferences(prefs, dir);
  assert.equal(path, getRuntimePrefsPath(dir));
  const loaded = await loadRuntimePreferences(dir);
  assert.equal(loaded?.version, 1);
  assert.equal(loaded?.provider?.model, "openrouter/owl-alpha");
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

