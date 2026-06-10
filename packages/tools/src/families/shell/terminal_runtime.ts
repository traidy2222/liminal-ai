/** UI + sidecar hook for per-chat interactive terminals (multi-tab). */

export type TerminalSessionSource = "agent" | "user";

export interface TerminalViewPayload {
  chatId: string;
  sessionId: string;
  label: string;
  source: TerminalSessionSource;
  cwd: string;
  open: boolean;
  focus: boolean;
  updatedAt: number;
}

export interface EnsureTerminalOptions {
  chatId: string;
  label?: string;
  source?: TerminalSessionSource;
  forceNew?: boolean;
  cwd?: string;
  cols?: number;
  rows?: number;
  focus?: boolean;
}

export interface EnsureTerminalResult {
  sessionId: string;
  label: string;
  cwd: string;
}

type TerminalViewPublisher = (payload: TerminalViewPayload) => void;
type TerminalEnsureHandler = (
  opts: EnsureTerminalOptions
) => Promise<EnsureTerminalResult | null>;

let viewPublisher: TerminalViewPublisher | null = null;
let ensureHandler: TerminalEnsureHandler | null = null;

export function setTerminalViewPublisher(fn: TerminalViewPublisher | null): void {
  viewPublisher = fn;
}

export function setTerminalEnsureHandler(fn: TerminalEnsureHandler | null): void {
  ensureHandler = fn;
}

export function publishTerminalView(payload: TerminalViewPayload): void {
  viewPublisher?.(payload);
}

/** Open or reuse a PTY session and surface it in the UI. */
export async function ensureChatTerminal(
  opts: EnsureTerminalOptions
): Promise<EnsureTerminalResult | null> {
  if (!ensureHandler) return null;
  const result = await ensureHandler(opts);
  if (!result) return null;
  publishTerminalView({
    chatId: opts.chatId,
    sessionId: result.sessionId,
    label: result.label,
    source: opts.source ?? "agent",
    cwd: result.cwd,
    open: true,
    focus: opts.focus !== false,
    updatedAt: Date.now(),
  });
  return result;
}
