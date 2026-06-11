import type { PtyManagerPort } from "@liminal/tools";
import type { EnsureTerminalOptions, EnsureTerminalResult } from "@liminal/tools";
import type { PtyManager } from "./pty_manager.js";

export function createPtyShellPort(
  mgr: PtyManager,
  ensure: (opts: EnsureTerminalOptions) => Promise<EnsureTerminalResult | null>,
  resolveWorkspaceRoot: (chatId: string) => string
): PtyManagerPort {
  return {
    ensure,
    write: (sessionId, data) => mgr.write(sessionId, data),
    readTail: (sessionId, chars) => mgr.readTail(sessionId, chars),
    onData: (sessionId, listener) => mgr.onSessionData(sessionId, listener),
    isAlive: (sessionId) => mgr.isAlive(sessionId),
    close: (sessionId) => mgr.close(sessionId),
    list: (chatId) =>
      mgr.list(chatId).map((s) => ({
        sessionId: s.sessionId,
        label: s.label,
        source: s.source,
        createdAt: s.createdAt,
        cwd: s.cwd,
      })),
    runOneshot: (opts) =>
      mgr.runOneshot({
        ...opts,
        workspaceRoot: resolveWorkspaceRoot(opts.chatId)?.trim() || process.cwd(),
      }),
  };
}
