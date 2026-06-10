import type { EnsureTerminalOptions, EnsureTerminalResult } from "@liminal/tools";
import type { PtyManager } from "./pty_manager.js";

export function buildPtyOpenedPayload(
  info: ReturnType<PtyManager["open"]>,
  streamPathPrefix = "/pty"
): {
  sessionId: string;
  chatId: string;
  workspaceRoot: string;
  cwd: string;
  cols: number;
  rows: number;
  label: string;
  source: "agent" | "user";
  streamPath: string;
} {
  return {
    sessionId: info.sessionId,
    chatId: info.chatId,
    workspaceRoot: info.workspaceRoot,
    cwd: info.cwd,
    cols: info.cols,
    rows: info.rows,
    label: info.label,
    source: info.source,
    streamPath: `${streamPathPrefix}?sessionId=${encodeURIComponent(info.sessionId)}`,
  };
}

/** Sidecar PTY open handler for agent `open_terminal` / auto-open on shell tools. */
export function createSidecarEnsureTerminal(opts: {
  ptyManager: PtyManager;
  resolveWorkspaceRoot: (chatId: string) => string;
  fallbackRoot: string;
}): (input: EnsureTerminalOptions) => Promise<EnsureTerminalResult | null> {
  return async (input) => {
    const chatId = input.chatId.trim();
    if (!chatId) return null;
    const workspaceRoot =
      opts.resolveWorkspaceRoot(chatId)?.trim() || opts.fallbackRoot;
    const info = opts.ptyManager.open({
      chatId,
      workspaceRoot,
      cols: input.cols,
      rows: input.rows,
      label: input.label,
      source: input.source,
      forceNew: input.forceNew,
      cwd: input.cwd,
    });
    return {
      sessionId: info.sessionId,
      label: info.label,
      cwd: info.cwd,
    };
  };
}
