/**
 * User-global storage layout — Phase 1 of the workspace split.
 *
 * Today everything lives under the workspace root (`AGENT_WORKSPACE_ROOT` / cwd):
 * memory notes, failures, recipe library, trajectory, persona, runtime prefs,
 * session logs, artifacts, write staging. That coupling means switching projects
 * (or running the agent from a different folder) loses all accumulated state.
 *
 * After the split:
 *   - User-global (cross-workspace, cross-chat):  ~/.liminal/
 *       notes.json, failures.jsonl, recipe_stats.json, trajectory/, persona/,
 *       runtime_prefs.json, vault/
 *   - Per-chat (one folder per conversation):     ~/.liminal/chats/<chatId>/
 *       session.jsonl, artifacts/, write_staging/inflight/, workspace/ (when
 *       the chat is in scratch mode)
 *   - Per-workspace (the user's actual project):  whatever folder the user
 *       picked, untouched by us — we never write .agent_* files into a chosen
 *       project folder by default
 *
 * Legacy compatibility: every reader in the stack still falls back to the old
 * workspace-local path when the global file does not yet exist. The first
 * write to a global file performs a one-shot copy from the legacy location so
 * users see no data loss. Set `AGENT_STORAGE_LAYOUT=legacy` to disable the
 * split entirely (kept for users who pin against the old behavior).
 */
import { existsSync, mkdirSync } from "node:fs";
import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { resolveWorkspaceRoot } from "./workspace_root.js";

/** Folder name under $HOME for all user-global liminal data. */
const GLOBAL_DIR_NAME = ".liminal";

/** Folder under the global dir where per-chat subfolders live. */
const CHATS_DIR_NAME = "chats";

/** Sentinel that disables the entire split (read/write goes to legacy paths). */
function isLegacyLayout(): boolean {
  return (process.env["AGENT_STORAGE_LAYOUT"] ?? "").trim().toLowerCase() === "legacy";
}

/**
 * Root of the user-global storage tree. Defaults to `~/.liminal/`. Overridable
 * via `AGENT_GLOBAL_STORAGE_ROOT` for tests, CI, or users who want it elsewhere
 * (e.g. an external drive / Dropbox folder).
 */
export function resolveGlobalStorageRoot(): string {
  const override = process.env["AGENT_GLOBAL_STORAGE_ROOT"]?.trim();
  if (override) return path.resolve(override);
  return path.join(homedir(), GLOBAL_DIR_NAME);
}

/** Eagerly ensure the global root exists (sync) — safe to call any number of times. */
export function ensureGlobalStorageRootSync(): string {
  const root = resolveGlobalStorageRoot();
  if (!existsSync(root)) {
    mkdirSync(root, { recursive: true });
  }
  return root;
}

/** Async ensure — returns the resolved root. */
export async function ensureGlobalStorageRoot(): Promise<string> {
  const root = resolveGlobalStorageRoot();
  await mkdir(root, { recursive: true });
  return root;
}

/**
 * Resolve a path under the global root, ensuring parent directories exist.
 * Returns the absolute path.
 */
export function globalPath(...segments: string[]): string {
  const root = resolveGlobalStorageRoot();
  return path.join(root, ...segments);
}

/**
 * Resolve the chats directory. Each chat gets its own subfolder named by chat
 * id (also serves as the harness `taskId` for legacy compatibility).
 */
export function globalChatsRoot(): string {
  return globalPath(CHATS_DIR_NAME);
}

/** Per-chat storage root. Created on demand by callers via `ensurePerChatDir`. */
export function perChatPath(chatId: string, ...segments: string[]): string {
  return path.join(globalChatsRoot(), sanitizeChatId(chatId), ...segments);
}

/** Async ensure for a per-chat subdir. */
export async function ensurePerChatDir(chatId: string, ...segments: string[]): Promise<string> {
  const p = perChatPath(chatId, ...segments);
  await mkdir(p, { recursive: true });
  return p;
}

/** Sync ensure for a per-chat subdir. */
export function ensurePerChatDirSync(chatId: string, ...segments: string[]): string {
  const p = perChatPath(chatId, ...segments);
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
  return p;
}

/**
 * Stripped chat id — never lets `..`, slashes, or other path-traversal chars
 * escape the chats root. Conservative: only `[A-Za-z0-9_.-]` survive.
 */
export function sanitizeChatId(chatId: string): string {
  const cleaned = chatId.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 96);
  return cleaned.length > 0 ? cleaned : "anonymous";
}

// ─── Tiered path resolution (global → legacy fallback) ───────────────────────
//
// Each well-known file (notes, failures, recipe stats, trajectory) has both a
// new global path and a legacy workspace-local path. Readers should prefer the
// global path when the file exists there, otherwise read from legacy. Writers
// always target the global path AFTER doing a one-shot copy from legacy if
// the global file doesn't yet exist (lazy migration).

export interface TieredPaths {
  /** Preferred path for new reads/writes. */
  global: string;
  /** Historical path under the workspace root. */
  legacy: string;
  /** True when the storage split is disabled and only legacy should be used. */
  legacyOnly: boolean;
}

/** Tiered paths for the memory store (`notes.json`). */
export function notesPaths(workspaceRoot?: string): TieredPaths {
  const wsRoot = workspaceRoot ?? resolveWorkspaceRoot();
  return {
    global: globalPath("notes.json"),
    legacy: path.join(wsRoot, ".agent_notes.json"),
    legacyOnly: isLegacyLayout(),
  };
}

/** Tiered paths for the soft-delete memory archive (`notes.archive.json`). Lives beside notes.json. */
export function notesArchivePaths(workspaceRoot?: string): TieredPaths {
  const wsRoot = workspaceRoot ?? resolveWorkspaceRoot();
  return {
    global: globalPath("notes.archive.json"),
    legacy: path.join(wsRoot, ".agent_notes.archive.json"),
    legacyOnly: isLegacyLayout(),
  };
}

/** Tiered paths for the failure log (`failures.jsonl`). */
export function failureLogPaths(workspaceRoot?: string): TieredPaths {
  const wsRoot = workspaceRoot ?? resolveWorkspaceRoot();
  return {
    global: globalPath("failures.jsonl"),
    legacy: path.join(wsRoot, ".agent_failures.jsonl"),
    legacyOnly: isLegacyLayout(),
  };
}

/** Tiered paths for the recipe library / outcome scorer (`recipe_stats.json`). */
export function recipeStatsPaths(workspaceRoot?: string): TieredPaths {
  const wsRoot = workspaceRoot ?? resolveWorkspaceRoot();
  return {
    global: globalPath("recipe_stats.json"),
    legacy: path.join(wsRoot, ".agent_recipe_stats.json"),
    legacyOnly: isLegacyLayout(),
  };
}

/** Tiered paths for runtime prefs (`runtime_prefs.json`). */
export function runtimePrefsPaths(workspaceRoot?: string): TieredPaths {
  const wsRoot = workspaceRoot ?? resolveWorkspaceRoot();
  return {
    global: globalPath("runtime_prefs.json"),
    legacy: path.join(wsRoot, ".agent_runtime_prefs.json"),
    legacyOnly: isLegacyLayout(),
  };
}

/** Tiered paths for the BM25/embedding memory index (`memory.index.json`). */
export function memoryIndexPaths(workspaceRoot?: string): TieredPaths {
  const wsRoot = workspaceRoot ?? resolveWorkspaceRoot();
  return {
    global: globalPath("memory.index.json"),
    legacy: path.join(wsRoot, ".agent_memory.index.json"),
    legacyOnly: isLegacyLayout(),
  };
}

/** Tiered paths for the vault semantic index (`vault.index.json`). User-global only — vault is user-global today. */
export function vaultIndexPaths(): TieredPaths {
  return {
    global: globalPath("vault.index.json"),
    legacy: globalPath("vault.index.json"),
    legacyOnly: isLegacyLayout(),
  };
}

/** Tiered paths for the persona active folder. */
export function personaActivePaths(workspaceRoot?: string): TieredPaths {
  const wsRoot = workspaceRoot ?? resolveWorkspaceRoot();
  return {
    global: globalPath("persona", "active"),
    legacy: path.join(wsRoot, "persona", "active"),
    legacyOnly: isLegacyLayout(),
  };
}

/**
 * Pick the path to read from. If global exists, return it. Otherwise return
 * legacy. When legacyOnly is set, always return legacy.
 */
export async function pickReadPath(paths: TieredPaths): Promise<string> {
  if (paths.legacyOnly) return paths.legacy;
  try {
    const s = await stat(paths.global);
    if (s.isFile() || s.isDirectory()) return paths.global;
  } catch {
    /* fallthrough to legacy */
  }
  return paths.legacy;
}

/**
 * Pick the path to write to. Always returns global when the split is active,
 * but first migrates the legacy file over (one-shot, idempotent) so the global
 * path has the user's existing data when they make their first write.
 */
export async function pickWritePath(paths: TieredPaths): Promise<string> {
  if (paths.legacyOnly) return paths.legacy;
  await ensureGlobalStorageRoot();
  // Lazy migration: if global doesn't exist but legacy does, copy it over.
  try {
    await stat(paths.global);
  } catch {
    try {
      const legacyStat = await stat(paths.legacy);
      if (legacyStat.isFile()) {
        await mkdir(path.dirname(paths.global), { recursive: true });
        await copyFile(paths.legacy, paths.global);
      }
    } catch {
      /* no legacy to migrate; first write creates the file fresh */
    }
  }
  return paths.global;
}

// ─── Workspace fingerprint for cross-workspace memory attribution ────────────

/**
 * Cheap synchronous fingerprint for the current workspace. Used as a memory
 * tag so notes from `~/projects/foo` and `~/work/foo` link when they share a
 * git remote, and as a soft-filter signal for the ranker. Falls back to the
 * resolved absolute path when no git remote is detectable.
 */
export function workspaceFingerprint(workspaceRoot?: string): string {
  const root = path.resolve(workspaceRoot ?? resolveWorkspaceRoot());
  // Try to read .git/config synchronously — cheap, runs once per harness boot
  // typically. Avoids spawning git, which would cost ~50ms.
  try {
    const cfgPath = path.join(root, ".git", "config");
    if (existsSync(cfgPath)) {
      const raw = readFileSyncSafe(cfgPath);
      const match = raw?.match(/url\s*=\s*([^\s]+)/i);
      if (match && match[1]) {
        return normalizeGitUrl(match[1]);
      }
    }
  } catch {
    /* fall through */
  }
  return `path:${root}`;
}

function readFileSyncSafe(p: string): string | null {
  try {
    // Defer to fs.readFileSync via a tiny helper; cheap and one-shot.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

/** Normalize git URLs so SSH and HTTPS clones of the same repo fingerprint identically. */
function normalizeGitUrl(url: string): string {
  let u = url.trim();
  // git@github.com:owner/repo.git → github.com/owner/repo
  u = u.replace(/^git@([^:]+):/i, "$1/");
  // https://github.com/owner/repo.git → github.com/owner/repo
  u = u.replace(/^https?:\/\//i, "");
  u = u.replace(/^ssh:\/\//i, "");
  u = u.replace(/\.git$/i, "");
  return `git:${u.toLowerCase()}`;
}
