import type { EnsureTerminalOptions, EnsureTerminalResult } from "./terminal_runtime.js";

export interface PtyOneshotOptions {
  chatId: string;
  command: string;
  cwd?: string;
  label?: string;
  cols?: number;
  rows?: number;
  timeoutMs: number;
  onData?: (chunk: string) => void;
  onSessionStart?: (info: {
    sessionId: string;
    label: string;
    cwd: string;
  }) => void;
}

export interface PtyOneshotResult {
  exitCode: number;
  output: string;
  sessionId: string;
}

/** Low-level port to the UI-backed `PtyManager` (sidecar / web). */
export interface PtyManagerPort {
  ensure(opts: EnsureTerminalOptions): Promise<EnsureTerminalResult | null>;
  write(sessionId: string, data: string): boolean;
  readTail(sessionId: string, chars: number): string;
  onData(sessionId: string, listener: (chunk: string) => void): () => void;
  isAlive(sessionId: string): boolean;
  close(sessionId: string): boolean;
  list(chatId: string): Array<{
    sessionId: string;
    label: string;
    source: string;
    createdAt: number;
    cwd: string;
  }>;
  /** Run one command in a short-lived PTY; shell exits with the real exit code. */
  runOneshot(opts: PtyOneshotOptions): Promise<PtyOneshotResult>;
}

let ptyShellPort: PtyManagerPort | null = null;

export function setPtyShellPort(port: PtyManagerPort | null): void {
  ptyShellPort = port;
}

export function getPtyShellPort(): PtyManagerPort | null {
  return ptyShellPort;
}
