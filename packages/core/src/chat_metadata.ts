/**
 * Per-chat metadata stored at `~/.liminal/chats/<chatId>/meta.json`.
 *
 * Phase 1 of the per-chat workspace model:
 *   - Records each chat's workspace mode (scratch / folder / reuse), bound path,
 *     creation time, and title.
 *   - Read by API endpoints for listing chats; written when a chat is created
 *     or its workspace binding changes.
 *
 * The chat id doubles as the harness `taskId` so SessionEventLog jsonl,
 * artifacts, write_staging, and meta.json all live in the same per-chat dir.
 */
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ensurePerChatDir,
  globalChatsRoot,
  perChatPath,
  sanitizeChatId,
} from "./global_storage.js";

export type ChatWorkspaceMode = "scratch" | "folder" | "reuse";

export interface ChatMetadata {
  chatId: string;
  /** Human-readable title (user-set, AI-summarized, or "Chat <id-prefix>"). */
  title: string;
  /** Which mode the chat was created with. */
  workspaceMode: ChatWorkspaceMode;
  /**
   * Absolute workspace path. For `scratch` chats this is
   * `~/.liminal/chats/<chatId>/workspace/`. For `folder`/`reuse` chats it's
   * the absolute path the user picked or the chat being reused.
   */
  workspaceRoot: string;
  /**
   * Workspace fingerprint at chat creation time (git remote or path). Memory
   * recall can use this to surface notes from sibling chats on the same repo.
   */
  workspaceFingerprint?: string;
  /** When the chat was created (epoch ms). */
  createdAt: number;
  /** When the chat was last opened / had its meta touched (epoch ms). */
  updatedAt: number;
}

function metaPath(chatId: string): string {
  return perChatPath(chatId, "meta.json");
}

/**
 * Resolve the path that a scratch chat uses for its workspace. Lives inside
 * the per-chat dir so deleting the chat cleans up the workspace too.
 */
export function scratchWorkspaceRoot(chatId: string): string {
  return perChatPath(chatId, "workspace");
}

export async function readChatMetadata(chatId: string): Promise<ChatMetadata | null> {
  try {
    const raw = await readFile(metaPath(chatId), "utf8");
    const parsed = JSON.parse(raw) as ChatMetadata;
    if (parsed && typeof parsed === "object" && parsed.chatId) return parsed;
    return null;
  } catch {
    return null;
  }
}

export async function writeChatMetadata(meta: ChatMetadata): Promise<void> {
  await ensurePerChatDir(meta.chatId);
  const target = metaPath(meta.chatId);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify({ ...meta, updatedAt: Date.now() }, null, 2), "utf8");
}

/** Touch the updatedAt for an existing chat — call when a chat is reopened. */
export async function touchChatMetadata(chatId: string): Promise<void> {
  const cur = await readChatMetadata(chatId);
  if (!cur) return;
  await writeChatMetadata({ ...cur, updatedAt: Date.now() });
}

/**
 * Create a new chat metadata record. Caller picks the workspace mode + root;
 * for scratch chats, pass `scratchWorkspaceRoot(chatId)` and ensure the dir
 * exists. Returns the written metadata.
 */
export async function createChatMetadata(input: {
  chatId: string;
  title?: string;
  workspaceMode: ChatWorkspaceMode;
  workspaceRoot: string;
  workspaceFingerprint?: string;
}): Promise<ChatMetadata> {
  const meta: ChatMetadata = {
    chatId: sanitizeChatId(input.chatId),
    title: input.title?.trim() || `Chat ${input.chatId.slice(0, 8)}`,
    workspaceMode: input.workspaceMode,
    workspaceRoot: path.resolve(input.workspaceRoot),
    workspaceFingerprint: input.workspaceFingerprint,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await writeChatMetadata(meta);
  if (input.workspaceMode === "scratch") {
    await mkdir(meta.workspaceRoot, { recursive: true });
  }
  return meta;
}

/**
 * List all chats with metadata. Chats without meta.json are skipped (legacy
 * session logs from before this feature shipped don't have meta files; they
 * surface separately via {@link listOrphanChatIds}).
 */
export async function listChats(): Promise<ChatMetadata[]> {
  const out: ChatMetadata[] = [];
  let entries: string[] = [];
  try {
    entries = await readdir(globalChatsRoot());
  } catch {
    return [];
  }
  for (const id of entries) {
    if (id.startsWith(".")) continue;
    const meta = await readChatMetadata(id);
    if (meta) out.push(meta);
  }
  // Newest first.
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

/**
 * Chat ids that have a per-chat dir but no meta.json — usually legacy session
 * runs from before this feature shipped. UI surfaces these as "imported" so
 * the user can name them / decide to keep or discard.
 */
export async function listOrphanChatIds(): Promise<string[]> {
  const out: string[] = [];
  let entries: string[] = [];
  try {
    entries = await readdir(globalChatsRoot());
  } catch {
    return [];
  }
  for (const id of entries) {
    if (id.startsWith(".")) continue;
    const meta = await readChatMetadata(id);
    if (meta) continue;
    try {
      const sessionStat = await stat(perChatPath(id, "session.jsonl"));
      if (sessionStat.isFile()) out.push(id);
    } catch {
      /* no session.jsonl */
    }
  }
  return out;
}
