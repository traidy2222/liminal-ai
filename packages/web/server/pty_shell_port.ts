import type { EnsureTerminalOptions, EnsureTerminalResult, PtyManagerPort } from "@liminal/tools";
import type { PtyManager } from "@liminal/sidecar/pty";
import { createWebEnsureTerminal } from "./pty_terminal.js";
import type { WebPtyContext } from "./pty_http.js";

export function createWebPtyShellPort(ctx: WebPtyContext): PtyManagerPort {
  const ensure = createWebEnsureTerminal(ctx);
  const mgr = ctx.ptyManager;
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
  };
}
