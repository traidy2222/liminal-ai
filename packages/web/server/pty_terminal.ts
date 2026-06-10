import type { EnsureTerminalOptions, EnsureTerminalResult } from "@liminal/tools";
import type { WebPtyContext } from "./pty_http.js";

/** Web PTY open handler for agent `open_terminal` / auto-open on shell tools. */
export function createWebEnsureTerminal(
  ctx: WebPtyContext
): (input: EnsureTerminalOptions) => Promise<EnsureTerminalResult | null> {
  return async (input) => {
    const chatId = input.chatId.trim();
    if (!chatId) return null;
    const workspaceRoot = await ctx.resolveWorkspaceRoot(chatId);
    const info = ctx.ptyManager.open({
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
