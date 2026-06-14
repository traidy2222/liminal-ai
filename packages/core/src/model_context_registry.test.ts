import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  clearModelContextCache,
  recordLearnedLimit,
  resolveModelContextLimits,
} from "./model_context_registry.js";
import { parseOpenRouterModelCatalog } from "./openrouter_models.js";

test("resolveModelContextLimits prefers OpenRouter catalog over heuristics", async () => {
  const catalog = parseOpenRouterModelCatalog({
    data: [{ id: "custom/small-model", context_length: 65_536 }],
  });
  const limits = await resolveModelContextLimits("custom/small-model", {
    openRouterCatalog: catalog,
  });
  assert.equal(limits.contextLength, 65_536);
  assert.equal(limits.source, "openrouter");
});

test("recordLearnedLimit wins over catalog on next resolve", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "liminal-ctx-"));
  const prev = process.env["AGENT_GLOBAL_STORAGE_ROOT"];
  process.env["AGENT_GLOBAL_STORAGE_ROOT"] = root;
  clearModelContextCache();
  try {
    const catalog = parseOpenRouterModelCatalog({
      data: [{ id: "custom/model", context_length: 200_000 }],
    });
    await recordLearnedLimit("custom/model", 162_144);
    const limits = await resolveModelContextLimits("custom/model", {
      openRouterCatalog: catalog,
    });
    assert.equal(limits.contextLength, 162_144);
    assert.equal(limits.source, "error_learned");
  } finally {
    clearModelContextCache();
    if (prev === undefined) delete process.env["AGENT_GLOBAL_STORAGE_ROOT"];
    else process.env["AGENT_GLOBAL_STORAGE_ROOT"] = prev;
    await rm(root, { recursive: true, force: true });
  }
});

test("resolveModelContextLimits uses managed catalog", async () => {
  clearModelContextCache();
  const limits = await resolveModelContextLimits("minimax-m2.7", {
    managedCatalog: [
      { id: "minimax-m2.7", label: "MiniMax", family: "minimax", contextLength: 196_608 },
    ],
  });
  assert.equal(limits.contextLength, 196_608);
  assert.equal(limits.source, "managed_api");
});
