import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureGlobalStorageRoot, globalPath } from "../global_storage.js";
import type { AppCacheEntry, LiminalAppSpec } from "./app_spec.js";
import { LIMINAL_APP_SPEC_V, normalizeAppSpec, isHtmlCapableType } from "./app_spec.js";
import { removeAppHtml } from "./app_html_store.js";

const APPS_DIR = "apps";
const MANIFEST_FILE = "manifest.json";
const CACHE_SUBDIR = "cache";

export interface AppManifest {
  v: 1;
  apps: LiminalAppSpec[];
}

function appsRoot(): string {
  return globalPath(APPS_DIR);
}

function manifestPath(): string {
  return path.join(appsRoot(), MANIFEST_FILE);
}

function cachePath(appId: string): string {
  return path.join(appsRoot(), CACHE_SUBDIR, `${appId.replace(/[^a-z0-9_-]/gi, "_")}.json`);
}

async function ensureAppsDir(): Promise<string> {
  const root = await ensureGlobalStorageRoot();
  const dir = path.join(root, APPS_DIR);
  await mkdir(path.join(dir, CACHE_SUBDIR), { recursive: true });
  return dir;
}

export async function readAppManifest(): Promise<AppManifest> {
  await ensureAppsDir();
  try {
    const raw = await readFile(manifestPath(), "utf8");
    const parsed = JSON.parse(raw) as AppManifest;
    const apps: LiminalAppSpec[] = [];
    for (const a of parsed.apps ?? []) {
      const norm = normalizeAppSpec(a);
      if (norm) apps.push(norm);
    }
    return { v: 1, apps };
  } catch {
    return { v: 1, apps: [] };
  }
}

async function writeManifest(manifest: AppManifest): Promise<void> {
  await ensureAppsDir();
  await writeFile(manifestPath(), JSON.stringify(manifest, null, 2), "utf8");
}

export async function listApps(): Promise<LiminalAppSpec[]> {
  const m = await readAppManifest();
  return m.apps;
}

export async function getApp(appId: string): Promise<LiminalAppSpec | null> {
  const apps = await listApps();
  return apps.find((a) => a.id === appId) ?? null;
}

export async function upsertApp(spec: LiminalAppSpec): Promise<LiminalAppSpec> {
  const manifest = await readAppManifest();
  const idx = manifest.apps.findIndex((a) => a.id === spec.id);
  const now = Date.now();
  const next: LiminalAppSpec = {
    ...spec,
    v: LIMINAL_APP_SPEC_V,
    updated_at: now,
    created_at: idx >= 0 ? manifest.apps[idx]!.created_at : spec.created_at || now,
  };
  if (idx >= 0) manifest.apps[idx] = next;
  else manifest.apps.push(next);
  await writeManifest(manifest);
  return next;
}

export async function removeApp(appId: string): Promise<boolean> {
  const manifest = await readAppManifest();
  const removed = manifest.apps.find((a) => a.id === appId);
  if (!removed) return false;
  manifest.apps = manifest.apps.filter((a) => a.id !== appId);
  await writeManifest(manifest);
  if (isHtmlCapableType(removed.type)) {
    await removeAppHtml(appId);
  }
  await unlink(cachePath(appId)).catch(() => undefined);
  return true;
}

export async function readAppCache(appId: string): Promise<AppCacheEntry | null> {
  try {
    const raw = await readFile(cachePath(appId), "utf8");
    return JSON.parse(raw) as AppCacheEntry;
  } catch {
    return null;
  }
}

export async function writeAppCache(appId: string, entry: AppCacheEntry): Promise<void> {
  await ensureAppsDir();
  await writeFile(cachePath(appId), JSON.stringify(entry, null, 2), "utf8");
}

export async function readAllAppCaches(): Promise<Record<string, AppCacheEntry>> {
  await ensureAppsDir();
  const dir = path.join(appsRoot(), CACHE_SUBDIR);
  let files: string[] = [];
  try {
    files = await readdir(dir);
  } catch {
    return {};
  }
  const out: Record<string, AppCacheEntry> = {};
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const id = f.slice(0, -5);
    const cache = await readAppCache(id);
    if (cache) out[id] = cache;
  }
  return out;
}
