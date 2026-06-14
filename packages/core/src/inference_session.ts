/**
 * In-process cache for Vireon managed-inference session JWTs (15m TTL).
 * Refreshed automatically before expiry on each root send().
 * Also persisted to disk for resilience across sidecar restarts.
 */
import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import path from "node:path";
import type { RuntimePreferences } from "./runtime_prefs.js";
import { fetchInferenceSession } from "./inference_provider.js";
import { globalPath, ensureGlobalStorageRoot } from "./global_storage.js";

const REFRESH_BUFFER_MS = 2 * 60_000;
const SESSION_CACHE_FILE = "inference-session.json";
const SECURE_FILE_MODE = 0o600;

interface SessionCacheRecord {
  version: 1;
  token: string;
  expiresAt: string;
  baseURL: string;
  cachedAt: number;
}

let cached: { token: string; expiresAtMs: number; baseURL: string } | null = null;

export function isManagedInferenceBaseUrl(baseURL: string): boolean {
  return baseURL.replace(/\/$/, "").includes("/inference");
}

function sessionCachePath(): string {
  return globalPath(SESSION_CACHE_FILE);
}

async function readSessionDiskCache(): Promise<{ token: string; expiresAtMs: number; baseURL: string } | null> {
  try {
    const raw = await readFile(sessionCachePath(), "utf8");
    const rec = JSON.parse(raw) as SessionCacheRecord;
    if (rec?.version !== 1 || !rec.token?.trim() || !rec.baseURL?.trim()) return null;
    const expiresAtMs = Date.parse(rec.expiresAt);
    if (!Number.isFinite(expiresAtMs)) return null;
    return { token: rec.token.trim(), expiresAtMs, baseURL: rec.baseURL.replace(/\/$/, "") };
  } catch {
    return null;
  }
}

async function writeSessionDiskCache(entry: { token: string; expiresAtMs: number; baseURL: string }): Promise<void> {
  try {
    await ensureGlobalStorageRoot();
    const p = sessionCachePath();
    const rec: SessionCacheRecord = {
      version: 1,
      token: entry.token,
      expiresAt: new Date(entry.expiresAtMs).toISOString(),
      baseURL: entry.baseURL,
      cachedAt: Date.now(),
    };
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, JSON.stringify(rec, null, 2), { encoding: "utf8", mode: SECURE_FILE_MODE });
    await chmod(p, SECURE_FILE_MODE);
  } catch {
    /* best-effort disk write */
  }
}

async function clearSessionDiskCache(): Promise<void> {
  try {
    const { unlink } = await import("node:fs/promises");
    await unlink(sessionCachePath()).catch(() => {});
  } catch {
    /* ignore */
  }
}

export function clearManagedInferenceSessionCache(): void {
  cached = null;
  void clearSessionDiskCache();
}

export async function ensureManagedInferenceSession(
  prefs?: RuntimePreferences | null,
  currentBaseURL?: string
): Promise<{ apiKey: string; baseURL: string } | null> {
  const base = (currentBaseURL ?? cached?.baseURL ?? "").replace(/\/$/, "");
  if (!base || !isManagedInferenceBaseUrl(base)) return null;

  const now = Date.now();
  if (cached && cached.expiresAtMs - now > REFRESH_BUFFER_MS && cached.baseURL === base) {
    return { apiKey: cached.token, baseURL: cached.baseURL };
  }

  const diskCache = await readSessionDiskCache();
  if (diskCache && diskCache.expiresAtMs - now > REFRESH_BUFFER_MS && diskCache.baseURL === base) {
    cached = diskCache;
    return { apiKey: cached.token, baseURL: cached.baseURL };
  }

  const session = await fetchInferenceSession(prefs);
  const expiresAtMs = Date.parse(session.expiresAt);
  cached = {
    token: session.token,
    expiresAtMs: Number.isFinite(expiresAtMs) ? expiresAtMs : now + 14 * 60_000,
    baseURL: session.baseURL.replace(/\/$/, ""),
  };
  await writeSessionDiskCache(cached);
  return { apiKey: cached.token, baseURL: cached.baseURL };
}
