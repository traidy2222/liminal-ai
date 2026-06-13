/**
 * Shared chat boot logic for web, TUI, and desktop sidecar.
 *
 * Resolves which chat to open on process start:
 *   - `restore_last` (default): reopen `~/.liminal/active_chat.json` when valid
 *   - `new_chat`: always create a fresh chat on process boot
 *   - `most_recent`: newest chat from disk (ignores active pointer)
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { readLastActiveChatId, saveLastActiveChatId } from "./active_chat_state.js";
import {
  adoptAllOrphanChats,
  createChatMetadata,
  listChats,
  readChatMetadata,
  scratchWorkspaceRoot,
  type ChatMetadata,
  type ChatWorkspaceMode,
} from "./chat_metadata.js";
import { effectiveHarnessEnvRaw } from "./harness_effective_env.js";
import { workspaceFingerprint } from "./global_storage.js";

export type ChatBootMode = "restore_last" | "new_chat" | "most_recent";

export interface ChatBootOptions {
  /** Override env `AGENT_CHAT_BOOT`. */
  mode?: ChatBootMode;
  /** Default folder for new folder-mode chats (web: cwd). */
  defaultWorkspaceRoot?: string;
  /** When true, refuse to bind default workspace to user home (web heuristic). */
  looksLikeUserHome?: (absPath: string) => boolean;
  /** When true, refuse to bind default workspace to this path (e.g. bundled repo). */
  rejectDefaultWorkspace?: (absPath: string) => boolean;
}

export interface ChatBootResult {
  meta: ChatMetadata;
  /** True when a brand-new chat record was created this boot. */
  created: boolean;
}

function resolveBootMode(override?: ChatBootMode): ChatBootMode {
  if (override) return override;
  const raw = effectiveHarnessEnvRaw("AGENT_CHAT_BOOT")?.trim().toLowerCase();
  if (raw === "new" || raw === "new_chat") return "new_chat";
  if (raw === "recent" || raw === "most_recent") return "most_recent";
  return "restore_last";
}

function defaultLooksLikeUserHome(absPath: string): boolean {
  const home = process.env["USERPROFILE"] || process.env["HOME"] || "";
  if (!home) return false;
  return path.resolve(absPath) === path.resolve(home);
}

async function createDefaultChat(opts: ChatBootOptions): Promise<ChatMetadata> {
  const cwd = path.resolve(
    opts.defaultWorkspaceRoot?.trim() ||
      process.env["AGENT_WORKSPACE_ROOT"]?.trim() ||
      process.cwd()
  );
  const looksHome = opts.looksLikeUserHome ?? defaultLooksLikeUserHome;
  const reject = opts.rejectDefaultWorkspace ?? (() => false);
  const chatId = `chat_${Date.now().toString(36)}`;
  const mode: ChatWorkspaceMode =
    cwd && existsSync(cwd) && !looksHome(cwd) && !reject(cwd) ? "folder" : "scratch";
  const root = mode === "folder" ? cwd : scratchWorkspaceRoot(chatId);
  const title = mode === "folder" ? path.basename(cwd) || "Workspace" : "New chat";
  return createChatMetadata({
    chatId,
    title,
    workspaceMode: mode,
    workspaceRoot: root,
    workspaceFingerprint: workspaceFingerprint(root),
  });
}

/**
 * Pick (or create) the chat every client should open on startup.
 */
export async function resolveChatBoot(opts: ChatBootOptions = {}): Promise<ChatBootResult> {
  await adoptAllOrphanChats().catch(() => undefined);
  const mode = resolveBootMode(opts.mode);

  if (mode === "new_chat") {
    const meta = await createDefaultChat(opts);
    await saveLastActiveChatId(meta.chatId);
    return { meta, created: true };
  }

  if (mode === "restore_last") {
    const lastId = await readLastActiveChatId();
    if (lastId) {
      const meta = await readChatMetadata(lastId);
      if (meta) {
        await saveLastActiveChatId(meta.chatId);
        return { meta, created: false };
      }
    }
  }

  const chats = await listChats();
  if (chats.length > 0) {
    const meta = chats[0]!;
    await saveLastActiveChatId(meta.chatId);
    return { meta, created: false };
  }

  const meta = await createDefaultChat(opts);
  await saveLastActiveChatId(meta.chatId);
  return { meta, created: true };
}
