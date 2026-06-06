/**
 * Cross-client pointer to the last active chat — stored at
 * `~/.liminal/active_chat.json` so web, TUI, and desktop sidecar agree on
 * which conversation to reopen after a process restart.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { ensureGlobalStorageRoot, globalPath } from "./global_storage.js";

const ACTIVE_CHAT_FILE = "active_chat.json";

export interface ActiveChatState {
  lastActiveChatId: string;
  updatedAt: number;
}

function activeChatPath(): string {
  return globalPath(ACTIVE_CHAT_FILE);
}

export async function readLastActiveChatId(): Promise<string | null> {
  try {
    await ensureGlobalStorageRoot();
    const raw = await readFile(activeChatPath(), "utf8");
    const parsed = JSON.parse(raw) as ActiveChatState;
    const id = parsed?.lastActiveChatId?.trim();
    return id || null;
  } catch {
    return null;
  }
}

export async function saveLastActiveChatId(chatId: string): Promise<void> {
  const id = chatId.trim();
  if (!id) return;
  await ensureGlobalStorageRoot();
  const target = activeChatPath();
  await mkdir(path.dirname(target), { recursive: true });
  const payload: ActiveChatState = { lastActiveChatId: id, updatedAt: Date.now() };
  await writeFile(target, JSON.stringify(payload, null, 2), "utf8");
}
