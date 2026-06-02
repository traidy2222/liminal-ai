#!/usr/bin/env node
/**
 * Live OpenRouter benchmark: compare provider routing strategies on cost + cache hits.
 *
 * Simulates a 2-round ReAct turn (static prefix + follow-up) per strategy using the
 * same model, session_id stickiness, and prompt-cache breakpoints as production.
 *
 * Usage:
 *   npm run build -w packages/core
 *   npm run benchmark:provider-strategies
 *   npm run benchmark:provider-strategies -- --model deepseek/deepseek-v4-pro
 */
import { config } from "dotenv";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: join(repoRoot, ".env") });

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const MODEL = arg("model", process.env.AGENT_MODEL?.trim() || "deepseek/deepseek-v4-pro");
const BASE_URL = (process.env.AGENT_API_BASE_URL?.trim() || "https://openrouter.ai/api/v1").replace(
  /\/$/,
  ""
);
const API_KEY =
  process.env.AGENT_API_KEY?.trim() ||
  process.env.OPENROUTER_API_KEY?.trim() ||
  "";

/** Strategies to compare — env patches applied per run (process.env wins). */
const STRATEGY_CASES = [
  {
    id: "adaptive",
    label: "Adaptive (sort=price + 429 rotation)",
    env: {
      AGENT_PROVIDER_STRATEGY: "adaptive",
      AGENT_PROVIDER_ORDER: "",
      AGENT_PROVIDER_ORDER_FAST: "",
      AGENT_PROVIDER_ALLOW_FALLBACKS: "1",
    },
  },
  {
    id: "price",
    label: "Price (sort=price, no epoch bump)",
    env: {
      AGENT_PROVIDER_STRATEGY: "price",
      AGENT_PROVIDER_ORDER: "",
      AGENT_PROVIDER_ALLOW_FALLBACKS: "1",
    },
  },
  {
    id: "cache_first_deepinfra",
    label: "Cache first — DeepInfra pin, no fallbacks",
    env: {
      AGENT_PROVIDER_STRATEGY: "cache_first",
      AGENT_PROVIDER_ORDER: "DeepInfra",
      AGENT_PROVIDER_ORDER_FAST: "DeepInfra",
      AGENT_PROVIDER_ROUTE_AUTO: "0",
      AGENT_PROVIDER_ALLOW_FALLBACKS: "0",
    },
  },
  {
    id: "cache_first_deepinfra_fb",
    label: "Cache first — DeepInfra pin + fallbacks",
    env: {
      AGENT_PROVIDER_STRATEGY: "cache_first",
      AGENT_PROVIDER_ORDER: "DeepInfra",
      AGENT_PROVIDER_ROUTE_AUTO: "0",
      AGENT_PROVIDER_ALLOW_FALLBACKS: "1",
    },
  },
  {
    id: "openrouter_default",
    label: "OpenRouter default (no provider prefs)",
    env: {
      AGENT_PROVIDER_STRATEGY: "openrouter_default",
      AGENT_PROVIDER_ORDER: "",
    },
  },
  {
    id: "throughput",
    label: "Throughput sort",
    env: {
      AGENT_PROVIDER_STRATEGY: "throughput",
      AGENT_PROVIDER_ORDER: "",
      AGENT_PROVIDER_ALLOW_FALLBACKS: "1",
    },
  },
  {
    id: "latency",
    label: "Latency sort",
    env: {
      AGENT_PROVIDER_STRATEGY: "latency",
      AGENT_PROVIDER_ORDER: "",
      AGENT_PROVIDER_ALLOW_FALLBACKS: "1",
    },
  },
];

const PROVIDER_ENV_KEYS = new Set([
  "AGENT_PROVIDER_STRATEGY",
  "AGENT_PROVIDER_SORT",
  "AGENT_PROVIDER_ORDER",
  "AGENT_PROVIDER_ORDER_FAST",
  "AGENT_PROVIDER_ROUTE_AUTO",
  "AGENT_PROVIDER_ALLOW_FALLBACKS",
  "AGENT_PROVIDER_IGNORE",
  "AGENT_PROVIDER_MAX_PRICE_PROMPT",
  "AGENT_PROVIDER_MAX_PRICE_COMPLETION",
  "AGENT_PROMPT_CACHE",
  "AGENT_PROMPT_CACHE_ROLLING",
  "AGENT_OPENROUTER_SESSIONS",
]);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** ~3k token static prefix stand-in for PROTOCOL_CORE. */
function buildStaticSystemPrompt() {
  const chunk =
    "You are a coding agent harness. Follow tool protocol, verify edits, prefer minimal diffs. " +
    "Named rules: R-EXECUTIVE-READ, R-EFFORT, R-MEMORY, R-WEB-RESEARCH. ";
  return chunk.repeat(180);
}

function buildBaseMessages() {
  return [
    { role: "system", content: buildStaticSystemPrompt() },
    { role: "user", content: "Reply with exactly: OK" },
  ];
}

function round2Messages() {
  return [
    ...buildBaseMessages(),
    { role: "assistant", content: "OK" },
    {
      role: "user",
      content:
        "Tool result (read_file): export function add(a: number, b: number) { return a + b; }\n" +
        "Summarize in one short sentence.",
    },
  ];
}

async function fetchGenerationMeta(generationId) {
  const url = `${BASE_URL}/generation?id=${encodeURIComponent(generationId)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${API_KEY}`, Accept: "application/json" },
  });
  if (!res.ok) return { costUsd: null, provider: null };
  const body = await res.json().catch(() => null);
  const data = body?.data;
  const costUsd =
    data && typeof data.total_cost === "number" && Number.isFinite(data.total_cost)
      ? data.total_cost
      : null;
  const provider =
    typeof data?.provider_name === "string" && data.provider_name.trim()
      ? data.provider_name.trim()
      : null;
  return { costUsd, provider };
}

function extractUsage(json) {
  const usage = json.usage ?? {};
  const promptTokens = Number(usage.prompt_tokens ?? 0) || 0;
  const completionTokens = Number(usage.completion_tokens ?? 0) || 0;
  const details = usage.prompt_tokens_details;
  const cachedTokens =
    Number(details?.cached_tokens ?? usage.cached_tokens ?? usage.cache_read_input_tokens ?? 0) ||
    0;
  const rawCost = usage.cost;
  const costUsd =
    typeof rawCost === "number" && Number.isFinite(rawCost)
      ? rawCost
      : typeof rawCost === "string"
        ? Number(rawCost)
        : null;
  return {
    promptTokens,
    completionTokens,
    cachedTokens,
    costUsd: costUsd != null && Number.isFinite(costUsd) ? costUsd : null,
    generationId: typeof json.id === "string" ? json.id : null,
  };
}

async function runRound(opts) {
  const started = Date.now();
  const body = {
    model: MODEL,
    messages: opts.messages,
    max_tokens: 48,
    temperature: 0,
    stream: false,
    ...opts.providerExtras,
  };

  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    const latencyMs = Date.now() - started;
    const text = await res.text();
    if (!res.ok) {
      return {
        round: 0,
        ok: false,
        latencyMs,
        promptTokens: 0,
        completionTokens: 0,
        cachedTokens: 0,
        costUsd: null,
        provider: null,
        generationId: null,
        error: `HTTP ${res.status}: ${text.slice(0, 300)}`,
      };
    }
    const json = JSON.parse(text);
    const u = extractUsage(json);
    let costUsd = u.costUsd;
    let provider = null;
    if (u.generationId) {
      await sleep(400);
      const meta = await fetchGenerationMeta(u.generationId);
      if (costUsd == null && meta.costUsd != null) costUsd = meta.costUsd;
      provider = meta.provider;
    }
    return {
      round: 0,
      ok: true,
      latencyMs,
      promptTokens: u.promptTokens,
      completionTokens: u.completionTokens,
      cachedTokens: u.cachedTokens,
      costUsd,
      provider,
      generationId: u.generationId,
    };
  } catch (err) {
    return {
      round: 0,
      ok: false,
      latencyMs: Date.now() - started,
      promptTokens: 0,
      completionTokens: 0,
      cachedTokens: 0,
      costUsd: null,
      provider: null,
      generationId: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function saveProviderEnvSnapshot() {
  const snap = {};
  for (const k of PROVIDER_ENV_KEYS) snap[k] = process.env[k];
  return snap;
}

function restoreProviderEnvSnapshot(snap) {
  for (const [k, v] of Object.entries(snap)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

function applyStrategyEnv(env) {
  for (const k of PROVIDER_ENV_KEYS) {
    if (!(k in env)) delete process.env[k];
  }
  for (const [k, v] of Object.entries(env)) {
    process.env[k] = v;
  }
  process.env.AGENT_PROMPT_CACHE = "1";
  process.env.AGENT_PROMPT_CACHE_ROLLING = "1";
  process.env.AGENT_OPENROUTER_SESSIONS = "1";
}

function scoreStrategy(rounds) {
  let totalCostUsd = 0;
  for (const r of rounds) {
    if (r.costUsd != null) totalCostUsd += r.costUsd;
  }
  const r2 = rounds[1];
  const round2CachePct =
    r2 && r2.promptTokens > 0 ? Math.round((r2.cachedTokens / r2.promptTokens) * 100) : 0;
  const cachePenalty = round2CachePct >= 15 ? 1 : round2CachePct >= 5 ? 1.08 : 1.18;
  const score = totalCostUsd * cachePenalty;
  return { totalCostUsd, round2CachePct, score };
}

async function benchmarkStrategy(caseDef, core, promptCache) {
  const snap = saveProviderEnvSnapshot();
  applyStrategyEnv(caseDef.env);

  const sessionId = `bench-${caseDef.id}-${Date.now()}`;
  const routeState = new core.ProviderRouteState();

  const baseMsgs = promptCache.applyPromptCacheBreakpoints(buildBaseMessages());
  const r2Msgs = promptCache.applyPromptCacheBreakpoints(round2Messages());

  const extras1 = core.buildOpenRouterChatRequestExtras({
    baseURL: BASE_URL,
    modelSlug: MODEL,
    routeState,
    sessionId,
  });
  const extras2 = core.buildOpenRouterChatRequestExtras({
    baseURL: BASE_URL,
    modelSlug: MODEL,
    routeState,
    sessionId,
    retryAttempt: 1,
  });

  const rounds = [];

  const r1 = await runRound({ messages: baseMsgs, sessionId, providerExtras: extras1 });
  r1.round = 1;
  rounds.push(r1);

  if (r1.ok) {
    await sleep(1200);
    const r2 = await runRound({ messages: r2Msgs, sessionId, providerExtras: extras2 });
    r2.round = 2;
    rounds.push(r2);
  }

  restoreProviderEnvSnapshot(snap);

  const ok = rounds.length === 2 && rounds.every((r) => r.ok);
  const { totalCostUsd, round2CachePct, score } = scoreStrategy(rounds);
  const totalLatencyMs = rounds.reduce((s, r) => s + r.latencyMs, 0);

  return {
    id: caseDef.id,
    label: caseDef.label,
    sessionId,
    rounds,
    totalCostUsd,
    totalLatencyMs,
    round2CachePct,
    round2Provider: rounds[1]?.provider ?? null,
    score,
    ok,
    error: ok ? undefined : rounds.find((r) => !r.ok)?.error,
  };
}

function printResults(results) {
  console.log("\n=== Provider strategy benchmark ===");
  console.log(`Model: ${MODEL}`);
  console.log(`Base:  ${BASE_URL}\n`);

  const ranked = [...results].sort((a, b) => {
    if (a.ok !== b.ok) return a.ok ? -1 : 1;
    return a.score - b.score;
  });

  console.log(
    "Rank | Strategy                  | Cost USD | R2 cache | Provider (R2)     | Latency | Score"
  );
  console.log("-".repeat(95));
  for (const r of ranked) {
    const rank = ranked.indexOf(r) + 1;
    const cost = r.ok ? `$${r.totalCostUsd.toFixed(6)}` : "FAIL";
    const cache = r.ok ? `${r.round2CachePct}%` : "—";
    const prov = (r.round2Provider ?? "—").slice(0, 17).padEnd(17);
    const lat = r.ok ? `${r.totalLatencyMs}ms` : "—";
    const score = r.ok ? r.score.toFixed(6) : "—";
    console.log(
      `${String(rank).padStart(4)} | ${r.id.padEnd(25)} | ${cost.padStart(8)} | ${cache.padStart(8)} | ${prov} | ${lat.padStart(7)} | ${score}`
    );
    if (!r.ok && r.error) console.log(`       error: ${r.error.slice(0, 120)}`);
  }

  const winner = ranked.find((r) => r.ok);
  if (winner) {
    console.log(`\nWinner (lowest adjusted score): ${winner.id}`);
    console.log(`  ${winner.label}`);
    console.log(
      `  Total cost: $${winner.totalCostUsd.toFixed(6)} | Round-2 cache: ${winner.round2CachePct}%`
    );
    if (winner.round2Provider) console.log(`  Provider: ${winner.round2Provider}`);
  }
}

async function main() {
  if (!API_KEY) {
    console.error("Set AGENT_API_KEY or OPENROUTER_API_KEY in .env to run live benchmark.");
    process.exit(2);
  }

  const core = await import("../packages/core/dist/index.js");
  const promptCache = await import("../packages/core/dist/prompt_cache.js");

  console.log(`Benchmarking ${STRATEGY_CASES.length} strategies (2 rounds each)…`);
  const results = [];

  for (const c of STRATEGY_CASES) {
    process.stdout.write(`  • ${c.id}… `);
    const r = await benchmarkStrategy(c, core, promptCache);
    results.push(r);
    console.log(
      r.ok ? `ok ($${r.totalCostUsd.toFixed(6)}, cache ${r.round2CachePct}%)` : "FAIL"
    );
    await sleep(2000);
  }

  printResults(results);

  const outDir = join(repoRoot, ".agent_benchmarks");
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = join(outDir, `provider-strategies-${stamp}.json`);
  writeFileSync(outPath, JSON.stringify({ model: MODEL, baseURL: BASE_URL, results }, null, 2));
  console.log(`\nWrote ${outPath}`);

  const winner = [...results].filter((r) => r.ok).sort((a, b) => a.score - b.score)[0];
  if (winner) {
    console.log(`\nRECOMMENDED_DEFAULT=${winner.id}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
