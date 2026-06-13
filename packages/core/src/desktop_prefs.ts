/**
 * Desktop-shell preferences stored at `~/.liminal/desktop_prefs.json`.
 * Shared by the Flutter app and `liminald` (not harness runtime prefs).
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureGlobalStorageRootSync, resolveGlobalStorageRoot } from "./global_storage.js";

export interface DesktopPrefs {
  /** Default folder for new chats when the user does not pick one explicitly. */
  defaultWorkspaceFolder?: string;
  updatedAt?: number;
}

function prefsPath(): string {
  ensureGlobalStorageRootSync();
  return path.join(resolveGlobalStorageRoot(), "desktop_prefs.json");
}

export async function readDesktopPrefs(): Promise<DesktopPrefs> {
  try {
    const raw = await readFile(prefsPath(), "utf8");
    const parsed = JSON.parse(raw) as DesktopPrefs;
    if (parsed && typeof parsed === "object") return parsed;
    return {};
  } catch {
    return {};
  }
}

export async function writeDesktopPrefs(
  patch: Partial<Omit<DesktopPrefs, "defaultWorkspaceFolder">> & {
    defaultWorkspaceFolder?: string | null;
  }
): Promise<DesktopPrefs> {
  const cur = await readDesktopPrefs();
  const next: DesktopPrefs = { ...cur, updatedAt: Date.now() };
  if ("defaultWorkspaceFolder" in patch) {
    const v = patch.defaultWorkspaceFolder?.trim();
    if (v) next.defaultWorkspaceFolder = v;
    else delete next.defaultWorkspaceFolder;
  }
  await writeFile(prefsPath(), JSON.stringify(next, null, 2), "utf8");
  return next;
}

/**
 * True when `absPath` is the bundled Liminal monorepo (desktop `liminald/repo` layout).
 * Those paths should not become user chat workspaces by default.
 */
export function isBundledRepoPath(absPath: string, repoRoot?: string): boolean {
  const resolved = path.resolve(absPath);
  if (repoRoot?.trim()) {
    if (path.resolve(repoRoot.trim()) === resolved) return true;
  }
  return /[\\/]liminald[\\/]repo$/i.test(resolved);
}
