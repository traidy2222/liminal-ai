import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

import { ensureGlobalStorageRoot, globalPath } from "./global_storage.js";
import {
  DEFAULT_MODEL_CONTEXT_TOKENS,
  parseContextLimitFromError,
  resolveModelContextWindowTokens,
} from "./model_context_window.js";
import {
  fetchOpenRouterModelCatalog,
  type OpenRouterModelLimits,
} from "./openrouter_models.js";
import type { ManagedInferenceModel } from "./inference_provider.js";

export type ModelContextSource = "openrouter" | "managed_api" | "error_learned" | "heuristic";

export type ModelContextLimits = {
  contextLength: number;
  maxCompletionTokens?: number;
  source: ModelContextSource;
};

type CacheEntry = ModelContextLimits & { updatedAt: string };

type ModelContextCacheFile = {
  version: 1;
  entries: Record<string, CacheEntry>;
};

const CACHE_FILE = "model_context_cache.json";

const SOURCE_PRIORITY: Record<ModelContextSource, number> = {
  error_learned: 4,
  openrouter: 3,
  managed_api: 2,
  heuristic: 1,
};

let memoryCache: ModelContextCacheFile | null = null;

function cachePath(): string {
  return globalPath(CACHE_FILE);
}

function normalizeSlug(slug: string): string {
  return slug.trim().toLowerCase();
}

async function loadCacheFile(): Promise<ModelContextCacheFile> {
  if (memoryCache) return memoryCache;
  const path = cachePath();
  if (!existsSync(path)) {
    memoryCache = { version: 1, entries: {} };
    return memoryCache;
  }
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as ModelContextCacheFile;
    if (parsed?.version === 1 && parsed.entries && typeof parsed.entries === "object") {
      memoryCache = parsed;
      return parsed;
    }
  } catch {
    /* fresh cache */
  }
  memoryCache = { version: 1, entries: {} };
  return memoryCache;
}

async function persistCache(cache: ModelContextCacheFile): Promise<void> {
  memoryCache = cache;
  await ensureGlobalStorageRoot();
  await writeFile(cachePath(), JSON.stringify(cache, null, 2), "utf8");
}

function mergeEntry(
  existing: CacheEntry | undefined,
  next: ModelContextLimits
): CacheEntry {
  if (!existing) {
    return { ...next, updatedAt: new Date().toISOString() };
  }
  if (SOURCE_PRIORITY[next.source] < SOURCE_PRIORITY[existing.source]) {
    return existing;
  }
  if (
    SOURCE_PRIORITY[next.source] === SOURCE_PRIORITY[existing.source] &&
    next.contextLength === existing.contextLength &&
    next.maxCompletionTokens === existing.maxCompletionTokens
  ) {
    return existing;
  }
  return {
    contextLength: next.contextLength,
    maxCompletionTokens: next.maxCompletionTokens ?? existing.maxCompletionTokens,
    source: next.source,
    updatedAt: new Date().toISOString(),
  };
}

async function readCachedLimits(slug: string): Promise<ModelContextLimits | null> {
  const cache = await loadCacheFile();
  const entry = cache.entries[normalizeSlug(slug)];
  if (!entry) return null;
  return {
    contextLength: entry.contextLength,
    maxCompletionTokens: entry.maxCompletionTokens,
    source: entry.source,
  };
}

async function writeCachedLimits(slug: string, limits: ModelContextLimits): Promise<void> {
  const cache = await loadCacheFile();
  const key = normalizeSlug(slug);
  cache.entries[key] = mergeEntry(cache.entries[key], limits);
  await persistCache(cache);
}

function lookupOpenRouterCatalog(
  catalog: Map<string, OpenRouterModelLimits>,
  slug: string
): ModelContextLimits | null {
  const trimmed = slug.trim();
  const hit =
    catalog.get(trimmed) ??
    catalog.get(normalizeSlug(trimmed));
  if (!hit) return null;
  return { contextLength: hit.contextLength, maxCompletionTokens: hit.maxCompletionTokens, source: "openrouter" };
}

function lookupManagedCatalog(
  catalog: ManagedInferenceModel[] | undefined,
  slug: string
): ModelContextLimits | null {
  if (!catalog?.length) return null;
  const key = normalizeSlug(slug);
  const row =
    catalog.find((m) => m.id.trim() === slug.trim()) ??
    catalog.find((m) => normalizeSlug(m.id) === key);
  if (!row?.contextLength || row.contextLength <= 0) return null;
  return {
    contextLength: row.contextLength,
    maxCompletionTokens: row.maxCompletionTokens,
    source: "managed_api",
  };
}

function heuristicLimits(slug: string): ModelContextLimits {
  return {
    contextLength: resolveModelContextWindowTokens(slug),
    source: "heuristic",
  };
}

/** Persist a limit learned from a provider error (wins over catalog data). */
export async function recordLearnedLimit(
  modelSlug: string,
  contextLength: number,
  maxCompletionTokens?: number
): Promise<ModelContextLimits> {
  const limits: ModelContextLimits = {
    contextLength,
    maxCompletionTokens,
    source: "error_learned",
  };
  await writeCachedLimits(modelSlug, limits);
  return limits;
}

export function clearModelContextCache(): void {
  memoryCache = null;
}

export type ResolveModelContextLimitsOpts = {
  apiKey?: string;
  baseURL?: string;
  managedCatalog?: ManagedInferenceModel[];
  openRouterCatalog?: Map<string, OpenRouterModelLimits>;
};

/**
 * Resolve context limits for a model slug.
 * Priority: error-learned cache → OpenRouter catalog → managed API catalog → heuristics.
 */
export async function resolveModelContextLimits(
  modelSlug: string,
  opts?: ResolveModelContextLimitsOpts
): Promise<ModelContextLimits> {
  const slug = modelSlug.trim();
  if (!slug) {
    return { contextLength: DEFAULT_MODEL_CONTEXT_TOKENS, source: "heuristic" };
  }

  const cached = await readCachedLimits(slug);
  if (cached?.source === "error_learned") return cached;

  let orCatalog = opts?.openRouterCatalog;
  if (!orCatalog && opts?.apiKey?.trim() && opts?.baseURL?.trim()) {
    orCatalog = await fetchOpenRouterModelCatalog(opts.apiKey, opts.baseURL);
  }
  const fromOr = orCatalog ? lookupOpenRouterCatalog(orCatalog, slug) : null;
  if (fromOr) {
    if (!cached || SOURCE_PRIORITY[fromOr.source] >= SOURCE_PRIORITY[cached.source]) {
      await writeCachedLimits(slug, fromOr);
      return fromOr;
    }
  }

  const fromManaged = lookupManagedCatalog(opts?.managedCatalog, slug);
  if (fromManaged) {
    if (!cached || SOURCE_PRIORITY[fromManaged.source] >= SOURCE_PRIORITY[cached.source]) {
      await writeCachedLimits(slug, fromManaged);
      return fromManaged;
    }
  }

  if (cached) return cached;

  const heuristic = heuristicLimits(slug);
  await writeCachedLimits(slug, heuristic);
  return heuristic;
}

/** Prefetch OpenRouter catalog + warm disk cache for the active model. */
export async function warmModelContextRegistry(
  modelSlug: string,
  opts?: ResolveModelContextLimitsOpts
): Promise<ModelContextLimits> {
  return resolveModelContextLimits(modelSlug, opts);
}
