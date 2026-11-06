import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { cacheRequestShape, normalizeCacheUsage, recordCacheUsage, readCacheStats, summarizeCacheUsage, type CacheUsageRecord } from "./cache_telemetry.js";
import { applyPromptCacheBreakpoints } from "./prompt_cache.js";
import { ProviderRouteState } from "./provider_route_state.js";
import { buildOpenRouterChatRequestExtras, providerAffinityPolicy, resolveProviderRouting } from "./provider_config.js";
import { buildCacheAwareRoutingProfile, neutralTurnInferenceResult } from "./intent_inference.js";
import type { Message } from "./types.js";

test("usage normalization distinguishes missing cache data from a real zero", () => {
  assert.deepEqual(normalizeCacheUsage({ prompt_tokens: 100, prompt_tokens_details: { cached_tokens: 80, cache_write_tokens: 5 }, completion_tokens: 20, cost: 0.01 }), { inputTokens: 100, cachedTokens: 80, cacheWriteTokens: 5, outputTokens: 20, costUsd: 0.01 });
  assert.equal(normalizeCacheUsage({ prompt_tokens: 100 }).cachedTokens, null);
  assert.equal(normalizeCacheUsage({ prompt_tokens: 100, prompt_tokens_details: { cached_tokens: 0 } }).cachedTokens, 0);
  assert.equal(normalizeCacheUsage({ prompt_cache_hit_tokens: 100, prompt_cache_miss_tokens: 20 }).inputTokens, 120);
  assert.equal(normalizeCacheUsage({ input_tokens: 10, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 }).inputTokens, 130);
  assert.equal(normalizeCacheUsage({ prompt_tokens: 10, cached_tokens: 100 }).cachedTokens, null);
});

test("rolling cache boundary excludes all current runtime state; fingerprints detect real rewrites", () => {
  const previous = process.env.AGENT_PROMPT_CACHE; process.env.AGENT_PROMPT_CACHE = "1";
  try {
    const stable: Message[] = [{ role: "system", content: "Stable identity" }, { role: "user", content: "Task" }, { role: "assistant", content: "Result" }];
    const tail: Message[] = [{ role: "system", content: "[TURN CONTEXT]\nSettings" }, { role: "system", content: "[WORKING STATE]\nProgress" }];
    const marked = applyPromptCacheBreakpoints([...stable, ...tail], 1);
    assert.ok(Array.isArray(marked[2]!.content)); assert.equal(typeof marked[3]!.content, "string");
    assert.equal(cacheRequestShape("fixture", "model", [...stable, ...tail], []).change, "first_request");
    const next: Message[] = [...stable, { role: "user", content: "Next step" }, ...tail];
    assert.equal(cacheRequestShape("fixture", "model", next, []).change, "append_only");
    assert.equal(cacheRequestShape("fixture", "model", next, [{ name: "new tool" }]).change, "tools_changed");
    next[1] = { role: "user", content: "Rewritten history" };
    assert.equal(cacheRequestShape("fixture", "model", next, [{ name: "new tool" }]).change, "history_rewritten");
    const route = buildCacheAwareRoutingProfile(neutralTurnInferenceResult(), "selected/model");
    assert.equal(route.modelSlug, "selected/model"); assert.equal(route.toolFilter, null);
  } finally { if (previous === undefined) delete process.env.AGENT_PROMPT_CACHE; else process.env.AGENT_PROMPT_CACHE = previous; }
});

test("persisted counters and provider affinity survive restart without locking out fallbacks", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "liminal-cache-"));
  const keys = ["AGENT_GLOBAL_STORAGE_ROOT", "AGENT_PROVIDER_STRATEGY", "AGENT_PROVIDER_ORDER", "AGENT_OPENROUTER_SESSIONS"];
  const before = keys.map(key => process.env[key]);
  process.env.AGENT_GLOBAL_STORAGE_ROOT = root; process.env.AGENT_PROVIDER_STRATEGY = "price";
  process.env.AGENT_PROVIDER_ORDER = ""; process.env.AGENT_OPENROUTER_SESSIONS = "1";
  try {
    const row: CacheUsageRecord = { ts: new Date().toISOString(), chatId: "fixture", scope: "agent", model: "deepseek/deepseek-chat", provider: "DeepInfra", requestId: "fixture-1", ...normalizeCacheUsage({ prompt_tokens: 100, cached_tokens: 80 }) };
    await recordCacheUsage(row); await recordCacheUsage({ ...row, requestId: "fixture-2", inputTokens: 900, cachedTokens: 0 });
    await recordCacheUsage({ ...row, scope: "title", requestId: "fixture-3", cachedTokens: null });
    const stats = await readCacheStats("fixture");
    assert.equal(stats.agent.cacheHitRate, 0.08, "aggregate token counts, not mean percentages");
    assert.equal(stats.agent.requestHitRate, 0.5); assert.equal(stats.all.coverage, 2 / 3);
    assert.equal(summarizeCacheUsage([]).cacheHitRate, null);
    const state = new ProviderRouteState(); state.configurePersistence(path.join(root, "affinity.json"));
    const options = { baseURL: "https://openrouter.ai/api/v1", modelSlug: row.model, sessionId: "fixture", routeState: state };
    const cold = buildOpenRouterChatRequestExtras(options);
    const policy = providerAffinityPolicy(row.model, resolveProviderRouting({ modelSlug: row.model, routeState: state }));
    state.recordProviderSuccess(row.model, policy, "DeepInfra");
    const warm = buildOpenRouterChatRequestExtras(options);
    assert.equal(warm.provider?.order, undefined); assert.equal(warm.provider?.allow_fallbacks, true);
    assert.equal(cold.session_id, warm.session_id, "learning a provider must not change cache identity");
    const restored = new ProviderRouteState(); restored.configurePersistence(path.join(root, "affinity.json"));
    assert.equal(buildOpenRouterChatRequestExtras({ ...options, routeState: restored }).provider?.order, undefined);
    process.env.AGENT_PROVIDER_ORDER = "Novita";
    assert.deepEqual(buildOpenRouterChatRequestExtras(options).provider?.only, ["Novita"]);
    assert.notDeepEqual(buildOpenRouterChatRequestExtras(options).provider?.order, ["DeepInfra"]);
    process.env.AGENT_PROVIDER_ORDER = "";
    state.markProviderRateLimited("DeepInfra", { bumpEpoch: true });
    const fallback = buildOpenRouterChatRequestExtras(options);
    assert.notDeepEqual(fallback.provider?.order, ["DeepInfra"]); assert.notEqual(fallback.session_id, warm.session_id);
    state.recordProviderSuccess(row.model, policy, "Novita");
    const afterFailover = new ProviderRouteState(); afterFailover.configurePersistence(path.join(root, "affinity.json"));
    assert.equal(buildOpenRouterChatRequestExtras({ ...options, routeState: afterFailover }).provider?.order, undefined);
  } finally {
    keys.forEach((key, i) => { if (before[i] === undefined) delete process.env[key]; else process.env[key] = before[i]; });
    assert.equal(path.dirname(root), path.resolve(os.tmpdir())); await fs.rm(root, { recursive: true, force: true });
  }
});
