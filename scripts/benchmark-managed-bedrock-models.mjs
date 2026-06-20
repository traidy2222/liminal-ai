#!/usr/bin/env node
/**
 * Probe Vireon managed inference (Bedrock upstream) for chat + JSON + embeddings.
 *
 * Usage:
 *   npx tsx scripts/benchmark-managed-bedrock-models.mjs
 *   npx tsx scripts/benchmark-managed-bedrock-models.mjs --all-chat
 */
import OpenAI from "openai";
import {
  fetchManagedInferenceModels,
  filterManagedInferenceCatalog,
  resolveManagedOpenRouterCredentials,
  buildManagedInferenceClientHeaders,
} from "../packages/core/src/inference_provider.ts";
import { fetchEmbeddings } from "../packages/core/src/embeddings.ts";
import { completeChatJson } from "../packages/core/src/router.ts";

const args = process.argv.slice(2);
const allChat = args.includes("--all-chat");
const concurrency = Math.max(1, Math.min(8, parseInt(args.find((a) => a.startsWith("--concurrency="))?.split("=")[1] ?? "4", 10)));

const EMBED_CANDIDATES = [
  "cohere.embed-v4:0",
  "us.cohere.embed-v4:0",
  "global.cohere.embed-v4:0",
  "eu.cohere.embed-v4:0",
];

/** Agent-relevant chat models (canonical ids, no geo duplicates). */
const CURATED_CHAT = [
  "zai.glm-5",
  "zai.glm-4.7-flash",
  "zai.glm-4.7",
  "anthropic.claude-opus-4-8",
  "anthropic.claude-opus-4-7",
  "anthropic.claude-sonnet-4-6",
  "anthropic.claude-haiku-4-5",
  "openai.gpt-5.5",
  "openai.gpt-5.4",
  "deepseek.v3.2",
  "deepseek.r1-v1:0",
  "moonshotai.kimi-k2.5",
  "moonshot.kimi-k2-thinking",
  "qwen.qwen3-coder-480b-a35b-v1:0",
  "qwen.qwen3-32b-v1:0",
  "qwen.qwen3-next-80b-a3b",
  "meta.llama4-maverick-17b-instruct-v1:0",
  "meta.llama4-scout-17b-instruct-v1:0",
  "minimax.minimax-m2.5",
  "minimax.minimax-m2.1",
  "amazon.nova-pro-v1:0",
  "amazon.nova-lite-v1:0",
  "amazon.nova-micro-v1:0",
  "mistral.mistral-large-3-675b-instruct",
  "mistral.ministral-3-3b-instruct",
  "nvidia.nemotron-nano-12b-v2",
  "google.gemma-3-27b-it",
  "writer.palmyra-x5-v1:0",
];

const SKIP_CHAT_RE =
  /embed|upscale|inpaint|outpaint|style-transfer|erase-object|remove-background|search-replace|search-recolor|control-sketch|control-structure|pegasus|marengo|stable-/i;

function isChatCandidate(id) {
  if (SKIP_CHAT_RE.test(id)) return false;
  return true;
}

async function mapPool(items, limit, fn) {
  const out = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

async function testChat(client, headers, model) {
  const t0 = Date.now();
  try {
    const res = await client.chat.completions.create(
      {
        model,
        messages: [
          { role: "system", content: "Reply with exactly one word: pong" },
          { role: "user", content: "ping" },
        ],
        max_tokens: 16,
        temperature: 0,
      },
      { headers }
    );
    const content = res.choices?.[0]?.message?.content?.trim() ?? "";
    return {
      model,
      ok: content.length > 0,
      kind: "chat",
      ms: Date.now() - t0,
      sample: content.slice(0, 40),
      error: content ? undefined : "empty completion",
    };
  } catch (e) {
    return {
      model,
      ok: false,
      kind: "chat",
      ms: Date.now() - t0,
      error: (e instanceof Error ? e.message : String(e)).slice(0, 200),
    };
  }
}

async function testJson(client, model) {
  const t0 = Date.now();
  try {
    const jr = await completeChatJson(client, {
      model,
      isFastModel: true,
      cache: false,
      messages: [
        {
          role: "user",
          content: 'Return JSON only: {"intent":"coding","confidence":0.9}',
        },
      ],
      maxTokens: 80,
      temperature: 0,
      signal: AbortSignal.timeout(90_000),
    });
    return {
      model,
      ok: jr.ok,
      kind: "json",
      ms: Date.now() - t0,
      error: jr.ok ? undefined : jr.error,
    };
  } catch (e) {
    return {
      model,
      ok: false,
      kind: "json",
      ms: Date.now() - t0,
      error: (e instanceof Error ? e.message : String(e)).slice(0, 200),
    };
  }
}

async function testEmbed(creds, model) {
  const t0 = Date.now();
  const headers = buildManagedInferenceClientHeaders(null, model);
  try {
    const r = await fetchEmbeddings({
      apiKey: creds.apiKey,
      baseURL: creds.baseURL,
      model,
      inputs: ["hello world"],
      signal: AbortSignal.timeout(60_000),
    });
    const dim = r.vectors[0]?.length ?? 0;
    return {
      model,
      ok: dim > 0,
      kind: "embed",
      ms: Date.now() - t0,
      sample: `dim=${dim}`,
      error: dim ? undefined : "empty vector",
    };
  } catch (e) {
    return {
      model,
      ok: false,
      kind: "embed",
      ms: Date.now() - t0,
      error: (e instanceof Error ? e.message : String(e)).slice(0, 200),
    };
  }
}

function printTable(rows) {
  const ok = rows.filter((r) => r.ok);
  const fail = rows.filter((r) => !r.ok);
  console.log(`\nOK (${ok.length}):`);
  for (const r of ok.sort((a, b) => a.ms - b.ms)) {
    console.log(`  ✓ ${r.model} [${r.kind}] ${r.ms}ms${r.sample ? ` — ${r.sample}` : ""}`);
  }
  if (fail.length) {
    console.log(`\nFAIL (${fail.length}):`);
    for (const r of fail) {
      console.log(`  ✗ ${r.model} [${r.kind}] ${r.ms}ms — ${r.error}`);
    }
  }
}

async function main() {
  const creds = await resolveManagedOpenRouterCredentials();
  if (creds.route !== "managed") {
    console.error("Managed inference not active — sign in with liminal login (Pro).");
    process.exit(1);
  }

  const catalog = await fetchManagedInferenceModels({ refresh: true });
  if (!catalog) {
    console.error("No model catalog — license missing?");
    process.exit(1);
  }

  const bedrockIds = new Set(filterManagedInferenceCatalog(catalog.models, "bedrock").map((m) => m.id));
  console.log(`Catalog: ${catalog.upstream} · ${catalog.region} · ${bedrockIds.size} Bedrock ids`);

  let chatModels = CURATED_CHAT.filter((id) => bedrockIds.has(id));
  if (allChat) {
    chatModels = [...bedrockIds].filter(isChatCandidate);
  }
  const embedModels = EMBED_CANDIDATES.filter((id) => bedrockIds.has(id));

  const client = new OpenAI({
    apiKey: creds.apiKey,
    baseURL: creds.baseURL,
  });

  console.log(`\nTesting ${chatModels.length} chat models (concurrency ${concurrency})...`);
  const chatResults = await mapPool(chatModels, concurrency, (model) =>
    testChat(client, buildManagedInferenceClientHeaders(null, model), model)
  );

  const jsonCandidates = chatResults
    .filter((r) => r.ok && /flash|haiku|micro|mini|lite|scout|3b|4\.7-flash|nova-micro/i.test(r.model))
    .map((r) => r.model)
    .slice(0, 12);
  if (!jsonCandidates.includes("zai.glm-4.7-flash") && bedrockIds.has("zai.glm-4.7-flash")) {
    jsonCandidates.unshift("zai.glm-4.7-flash");
  }
  console.log(`\nTesting ${jsonCandidates.length} fast-tier JSON sidecars...`);
  const jsonResults = await mapPool(jsonCandidates, concurrency, (model) => testJson(client, model));

  console.log(`\nTesting ${embedModels.length} embedding models...`);
  const embedResults = await mapPool(embedModels, 2, (model) => testEmbed(creds, model));

  printTable(chatResults);
  printTable(jsonResults);
  printTable(embedResults);

  const mainOk = chatResults.filter((r) => r.ok && !/flash|haiku|micro|scout|lite|3b|mini/i.test(r.model));
  const fastOk = jsonResults.filter((r) => r.ok);
  const embedOk = embedResults.filter((r) => r.ok);

  console.log("\n=== Suggested Bedrock pairs (chat ok + json ok fast) ===");
  for (const main of mainOk.slice(0, 8)) {
    const fast = fastOk.find((f) => f.model.split(".")[0] === main.model.split(".")[0]) ?? fastOk[0];
  }
  const pairs = [
    ["zai.glm-5", "zai.glm-4.7-flash"],
    ["anthropic.claude-opus-4-8", "anthropic.claude-haiku-4-5"],
    ["anthropic.claude-sonnet-4-6", "anthropic.claude-haiku-4-5"],
    ["openai.gpt-5.5", "amazon.nova-micro-v1:0"],
    ["qwen.qwen3-coder-480b-a35b-v1:0", "qwen.qwen3-32b-v1:0"],
    ["meta.llama4-maverick-17b-instruct-v1:0", "meta.llama4-scout-17b-instruct-v1:0"],
    ["moonshotai.kimi-k2.5", "anthropic.claude-haiku-4-5"],
    ["deepseek.v3.2", "zai.glm-4.7-flash"],
  ];
  for (const [main, fast] of pairs) {
    const m = chatResults.find((r) => r.model === main);
    const f = jsonResults.find((r) => r.model === fast) ?? chatResults.find((r) => r.model === fast);
    const tag = m?.ok && f?.ok ? "✓" : m?.ok || f?.ok ? "~" : "✗";
    console.log(
      `  ${tag} ${main} + ${fast}` +
        (m?.ok ? ` (main ${m.ms}ms)` : ` (main FAIL: ${m?.error ?? "n/a"})`) +
        (f?.ok ? ` (fast ${f.ms}ms)` : ` (fast FAIL: ${f?.error ?? "n/a"})`)
    );
  }

  const bestEmbed = embedOk.sort((a, b) => a.ms - b.ms)[0];
  console.log(`\nBest embed: ${bestEmbed?.model ?? "none"} (${bestEmbed?.sample ?? ""})`);

  const failed = [...chatResults, ...jsonResults, ...embedResults].filter((r) => !r.ok).length;
  process.exit(failed > 0 ? 0 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
