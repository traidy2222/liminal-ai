import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import {
  isBundledRepoPath,
  readDesktopPrefs,
  scratchWorkspaceRoot,
  type ChatWorkspaceMode,
} from "@liminal/core";

export interface ResolveNewChatWorkspaceInput {
  chatId: string;
  repoRoot: string;
  workspaceMode?: ChatWorkspaceMode;
  workspaceRoot?: string;
  /** Mission Control chats always use an isolated scratch dir. */
  orchestrator?: boolean;
}

export interface ResolvedChatWorkspace {
  mode: ChatWorkspaceMode;
  root: string;
}

async function assertDirectory(absPath: string): Promise<void> {
  const s = await stat(absPath);
  if (!s.isDirectory()) {
    throw new Error(`workspaceRoot is not a directory: ${absPath}`);
  }
}

/**
 * Pick workspace mode + absolute root for a new chat (mirrors web `chatManager.create`).
 */
export async function resolveNewChatWorkspace(
  input: ResolveNewChatWorkspaceInput
): Promise<ResolvedChatWorkspace> {
  if (input.orchestrator) {
    return { mode: "scratch", root: scratchWorkspaceRoot(input.chatId) };
  }

  const explicitMode = input.workspaceMode;
  const explicitRoot = input.workspaceRoot?.trim();

  if (explicitMode === "folder" || explicitMode === "reuse") {
    if (!explicitRoot) throw new Error("workspaceRoot required for folder/reuse mode");
    const root = path.resolve(explicitRoot);
    await assertDirectory(root);
    return { mode: explicitMode, root };
  }

  if (explicitRoot) {
    const root = path.resolve(explicitRoot);
    await assertDirectory(root);
    return { mode: "folder", root };
  }

  if (explicitMode === "scratch") {
    return { mode: "scratch", root: scratchWorkspaceRoot(input.chatId) };
  }

  const prefs = await readDesktopPrefs();
  const defaultFolder = prefs.defaultWorkspaceFolder?.trim();
  if (
    defaultFolder &&
    existsSync(defaultFolder) &&
    !isBundledRepoPath(defaultFolder, input.repoRoot)
  ) {
    const root = path.resolve(defaultFolder);
    await assertDirectory(root);
    return { mode: "folder", root };
  }

  return { mode: "scratch", root: scratchWorkspaceRoot(input.chatId) };
}
