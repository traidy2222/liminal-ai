import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { globalPath } from "./global_storage.js";
import { isVolatileRuntimeMessage } from "./prompt_cache.js";
import type { Message } from "./types.js";

export interface CacheUsageRecord {
  ts: string; chatId: string; scope: "agent" | "auxiliary" | "title";
  model: string; provider: string | null; requestId: string | null;
  inputTokens: number | null; cachedTokens: number | null;
  cacheWriteTokens: number | null; outputTokens: number | null; costUsd: number | null;
  toolsHash?: string; toolsCount?: number; stablePrefixHash?: string;
  change?: "first_request" | "tools_changed" | "history_rewritten" | "append_only";
  ttftMs?: number; latencyMs?: number;
  providerEndpoint?: string;
}

const numeric = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
export function normalizeCacheUsage(usage: unknown): Pick<CacheUsageRecord, "inputTokens" | "cachedTokens" | "cacheWriteTokens" | "outputTokens" | "costUsd"> {
  const value = (usage && typeof usage === "object" ? usage : {}) as Record<string, any>;
  const details = value.prompt_tokens_details ?? value.input_tokens_details ?? {};
  const cached = numeric(details.cached_tokens ?? value.prompt_cache_hit_tokens ?? value.cache_read_input_tokens ?? value.cached_tokens);
  const written = numeric(details.cache_write_tokens ?? value.cache_creation_input_tokens);
  let input = numeric(value.prompt_tokens ?? value.input_tokens);
  // Native Anthropic reports fresh input separately; normalized OpenRouter/Responses totals do not.
  if (value.prompt_tokens === undefined && value.input_tokens_details === undefined && value.cache_read_input_tokens !== undefined && input !== null) input += (cached ?? 0) + (written ?? 0);
  if (input === null && numeric(value.prompt_cache_miss_tokens) !== null && cached !== null) input = value.prompt_cache_miss_tokens + cached;
  return { inputTokens: input, cachedTokens: input !== null && cached !== null && cached > input ? null : cached,
    cacheWriteTokens: written, outputTokens: numeric(value.completion_tokens ?? value.output_tokens), costUsd: numeric(value.cost) };
}

export function summarizeCacheUsage(records: CacheUsageRecord[]) {
  const known = records.filter(row => row.inputTokens !== null && row.cachedTokens !== null);
  const inputTokens = known.reduce((sum, row) => sum + row.inputTokens!, 0);
  const cachedTokens = known.reduce((sum, row) => sum + row.cachedTokens!, 0);
  const reportedInputTokens = records.reduce((sum, row) => sum + (row.inputTokens ?? 0), 0);
  return { requests: records.length, reportedRequests: known.length, unknownRequests: records.length - known.length,
    inputTokens, reportedInputTokens, cachedTokens, uncachedTokens: inputTokens - cachedTokens,
    inputTokenCoverage: reportedInputTokens > 0 ? inputTokens / reportedInputTokens : null,
    cacheWriteTokens: records.reduce((sum, row) => sum + (row.cacheWriteTokens ?? 0), 0),
    cacheHitRate: inputTokens > 0 ? cachedTokens / inputTokens : null,
    requestHitRate: known.length ? known.filter(row => row.cachedTokens! > 0).length / known.length : null,
    coverage: records.length ? known.length / records.length : null,
    reportedCostUsd: records.reduce((sum, row) => sum + (row.costUsd ?? 0), 0) };
}

let writes = Promise.resolve();
export function recordCacheUsage(record: CacheUsageRecord): Promise<void> {
  const target = globalPath("cache_usage.jsonl");
  writes = writes.catch(() => undefined).then(async () => {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.appendFile(target, JSON.stringify(record) + "\n", "utf8");
  });
  return writes;
}

/** Bounded read; rates explicitly cover the retained telemetry window, not account billing. */
export async function readCacheStats(chatId?: string) {
  await writes.catch(() => undefined);
  let text = "";
  try {
    const file = await fs.open(globalPath("cache_usage.jsonl"), "r");
    try {
      const { size } = await file.stat(); const start = Math.max(0, size - 8 * 1024 * 1024);
      const buffer = Buffer.alloc(size - start); await file.read(buffer, 0, buffer.length, start);
      text = buffer.toString("utf8"); if (start) text = text.slice(text.indexOf("\n") + 1);
    } finally { await file.close(); }
  } catch { /* no responses measured yet */ }
  const records = text.split("\n").flatMap(line => { try { const row = JSON.parse(line); return row.model && (!chatId || row.chatId === chatId) ? [row as CacheUsageRecord] : []; } catch { return []; } }).slice(-5000);
  const agent = records.filter(row => row.scope === "agent");
  const group = (key: (row: CacheUsageRecord) => string) => Object.fromEntries([...new Set(records.map(key))].map(name => [name, summarizeCacheUsage(records.filter(row => key(row) === name))]));
  return { windowLimit: 5000, firstRecordAt: records[0]?.ts ?? null, lastRecordAt: records.at(-1)?.ts ?? null,
    all: summarizeCacheUsage(records), agent: summarizeCacheUsage(agent), last15: summarizeCacheUsage(agent.slice(-15)), last50: summarizeCacheUsage(agent.slice(-50)),
    byModel: group(row => row.model), byProvider: group(row => row.provider ?? "unreported"), byScope: group(row => row.scope) };
}

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
const previousRequests = new Map<string, { tools: string; messages: string[] }>();
export function cacheRequestShape(chatId: string, model: string, messages: Message[], tools: unknown[]) {
  const toolsHash = hash(tools);
  let end = messages.length; while (end && isVolatileRuntimeMessage(messages[end - 1]!)) end--;
  const fingerprints = messages.slice(0, end).map(hash);
  const key = `${chatId}:${model}`, previous = previousRequests.get(key);
  const change = !previous ? "first_request" : previous.tools !== toolsHash ? "tools_changed"
    : previous.messages.some((value, index) => fingerprints[index] !== value) ? "history_rewritten" : "append_only";
  previousRequests.delete(key); previousRequests.set(key, { tools: toolsHash, messages: fingerprints });
  if (previousRequests.size > 256) previousRequests.delete(previousRequests.keys().next().value!);
  return { toolsHash, toolsCount: tools.length, stablePrefixHash: hash(fingerprints.slice(0, 2)), change } as const;
}
