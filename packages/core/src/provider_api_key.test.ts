import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  ensureProviderApiKeysInProcess,
  isCastAiApiKey,
  providerApiKeyEnvFileCandidates,
} from "./provider_api_key.js";
import { isProviderApiKeyConfigured, resolveProviderConfig } from "./provider_config.js";
import { KIMCHI_API_BASE_URL } from "./kimchi_provider.js";

function saveEnv(keys: string[]): Record<string, string | undefined> {
  const prev: Record<string, string | undefined> = {};
  for (const k of keys) prev[k] = process.env[k];
  return prev;
}

function restoreEnv(prev: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(prev)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

test("isCastAiApiKey recognizes castai_v1 prefix", () => {
  assert.equal(isCastAiApiKey("castai_v1_abc"), true);
  assert.equal(isCastAiApiKey("sk-or-v1-abc"), false);
});

test("ensureProviderApiKeysInProcess hydrates KIMCHI_API_KEY from repo .env", () => {
  const prev = saveEnv([
    "KIMCHI_API_KEY",
    "AGENT_API_KEY",
    "OPENROUTER_API_KEY",
    "LIMINAL_REPO_ROOT",
  ]);
  const dir = mkdtempSync(join(tmpdir(), "liminal-kimchi-env-"));
  try {
    delete process.env["KIMCHI_API_KEY"];
    process.env["AGENT_API_KEY"] = "sk-or-v1-openrouter-only";
    process.env["LIMINAL_REPO_ROOT"] = dir;
    writeFileSync(
      join(dir, ".env"),
      "KIMCHI_API_KEY=castai_v1_test_key_from_disk\n",
      "utf8"
    );

    ensureProviderApiKeysInProcess();
    assert.equal(process.env["KIMCHI_API_KEY"], "castai_v1_test_key_from_disk");
    assert.ok(providerApiKeyEnvFileCandidates().some((p) => p.includes(dir)));

    const cfg = resolveProviderConfig({ baseURL: KIMCHI_API_BASE_URL });
    assert.equal(cfg.apiKey, "castai_v1_test_key_from_disk");
    assert.equal(cfg.keySource, "KIMCHI_API_KEY");
    assert.ok(isProviderApiKeyConfigured({ baseURL: KIMCHI_API_BASE_URL }));
  } finally {
    restoreEnv(prev);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("openrouter base ignores castai AGENT_API_KEY and uses OPENROUTER_API_KEY", () => {
  const prev = saveEnv(["KIMCHI_API_KEY", "OPENROUTER_API_KEY", "AGENT_API_KEY"]);
  try {
    process.env["AGENT_API_KEY"] = "castai_v1_stale_from_kimchi";
    process.env["OPENROUTER_API_KEY"] = "sk-or-v1-openrouter-live";
    delete process.env["KIMCHI_API_KEY"];
    const cfg = resolveProviderConfig({ baseURL: "https://openrouter.ai/api/v1" });
    assert.equal(cfg.apiKey, "sk-or-v1-openrouter-live");
    assert.equal(cfg.keySource, "OPENROUTER_API_KEY");
    assert.equal(process.env["AGENT_API_KEY"], undefined);
  } finally {
    restoreEnv(prev);
  }
});

test("kimchi base does not use OpenRouter AGENT_API_KEY fallback", () => {
  const prev = saveEnv(["KIMCHI_API_KEY", "CASTAI_API_KEY", "AGENT_API_KEY"]);
  try {
    delete process.env["KIMCHI_API_KEY"];
    delete process.env["CASTAI_API_KEY"];
    process.env["AGENT_API_KEY"] = "sk-or-v1-openrouter";
    assert.throws(
      () => resolveProviderConfig({ baseURL: KIMCHI_API_BASE_URL }),
      /Kimchi API key/
    );
  } finally {
    restoreEnv(prev);
  }
});
