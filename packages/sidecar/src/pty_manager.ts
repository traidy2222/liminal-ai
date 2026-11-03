import { EventEmitter } from "node:events";
import os from "node:os";
import path from "node:path";
import { statSync } from "node:fs";
import { execFile } from "node:child_process";
import * as pty from "node-pty";
import { buildInteractivePtyLaunch, buildOneshotPtyLaunch, prepareShellChildEnvironment } from "@liminal/core";

export type PtySessionSource = "agent" | "user";

export interface PtySessionInfo {
  sessionId: string;
  chatId: string;
  workspaceRoot: string;
  cols: number;
  rows: number;
  cwd: string;
  label: string;
  source: PtySessionSource;
  createdAt: number;
}

interface PtySessionRecord {
  info: PtySessionInfo;
  pty: pty.IPty;
  sockets: Set<import("ws").WebSocket>;
  outputBacklog: string;
  dataListeners: Set<(chunk: string) => void>;
}

const MAX_OUTPUT_BACKLOG = 512 * 1024;
const MAX_SESSIONS_PER_CHAT = 8;

function validateRequestedCwd(cwd: string): void {
  try {
    if (statSync(cwd).isDirectory()) return;
  } catch { /* Provide the requested directory rather than a native error code. */ }
  throw new Error(`Terminal cwd is not an existing directory: "${cwd}". Use an existing directory, or omit cwd to use the workspace.`);
}

function terminateOwnedPty(proc: pty.IPty, done: () => void = () => undefined): void {
  const close = () => { try { proc.kill(); } catch { /* already exited */ } done(); };
  const pid = proc.pid;
  if (!Number.isSafeInteger(pid) || pid <= 0) { close(); return; }
  if (process.platform === "win32") {
    execFile("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, timeout: 5000 }, close);
  } else {
    try { process.kill(-pid, "SIGKILL"); } catch { /* already exited */ }
    close();
  }
}

/** Keep ordinary shell configuration, but do not copy harness/provider credentials. */
function terminalEnvironment(executable: string, extra: NodeJS.ProcessEnv = {}): Record<string, string> {
  const environment = prepareShellChildEnvironment(executable, { ...process.env, ...extra });
  return Object.fromEntries(Object.entries(environment).filter(([name, value]) =>
    value !== undefined && !/(api_?key|token|secret|password|passwd|credential|private_?key|access_?key|captcha_?key|_key$)/i.test(name)
  )) as Record<string, string>;
}

export interface PtyOneshotInput {
  chatId: string;
  workspaceRoot: string;
  command: string;
  cwd?: string;
  label?: string;
  cols?: number;
  rows?: number;
  timeoutMs: number;
  signal?: AbortSignal;
  onData?: (chunk: string) => void;
  onSessionStart?: (info: PtySessionInfo) => void;
}

export interface PtyOneshotResult {
  exitCode: number;
  output: string;
  sessionId: string;
}

function newSessionId(chatId: string): string {
  return `pty_${chatId}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function defaultLabel(source: PtySessionSource, index: number): string {
  if (source === "agent") return index === 0 ? "Agent shell" : `Agent shell ${index + 1}`;
  return index === 0 ? "Terminal" : `Terminal ${index + 1}`;
}

/**
 * Per-chat interactive shell sessions backed by `node-pty`.
 * Multiple sessions per chat; first agent session is reused unless `forceNew`.
 */
export class PtyManager extends EventEmitter {
  private readonly sessions = new Map<string, PtySessionRecord>();
  /** Ordered session ids per chat (oldest first). */
  private readonly chatSessions = new Map<string, string[]>();
  /** In-flight open() per chat+source — prevents duplicate agent shells from parallel ensure calls. */
  private readonly openInflight = new Map<string, string>();

  private publishData(record: PtySessionRecord, data: string): void {
    if (this.sessions.get(record.info.sessionId) !== record) return;
    record.outputBacklog = (record.outputBacklog + data).slice(-MAX_OUTPUT_BACKLOG);
    try { this.emit("data", record.info.sessionId, record.info.chatId, data); } catch { /* observer */ }
    for (const listener of record.dataListeners) {
      try { listener(data); } catch { /* observer */ }
    }
    for (const socket of record.sockets) {
      try { if (socket.readyState === socket.OPEN) socket.send(data); } catch { /* disconnected */ }
    }
  }

  private releaseSession(record: PtySessionRecord, exitCode: number): void {
    const { sessionId, chatId } = record.info;
    if (this.sessions.get(sessionId) !== record) return;
    this.sessions.delete(sessionId);
    const remaining = (this.chatSessions.get(chatId) ?? []).filter(id => id !== sessionId);
    if (remaining.length) this.chatSessions.set(chatId, remaining);
    else this.chatSessions.delete(chatId);
    for (const socket of record.sockets) {
      try { socket.close(1000, "pty_exit"); } catch { /* disconnected */ }
    }
    record.sockets.clear();
    record.dataListeners.clear();
    try { this.emit("exit", sessionId, chatId, exitCode); } catch { /* observer */ }
  }

  list(chatId?: string): PtySessionInfo[] {
    const all = [...this.sessions.values()].map((s) => s.info);
    if (!chatId) return all;
    const order = this.chatSessions.get(chatId.trim()) ?? [];
    const byId = new Map(all.filter((s) => s.chatId === chatId).map((s) => [s.sessionId, s]));
    return order.map((id) => byId.get(id)).filter((s): s is PtySessionInfo => s != null);
  }

  get(sessionId: string): PtySessionInfo | null {
    return this.sessions.get(sessionId)?.info ?? null;
  }

  getPrimary(chatId: string): PtySessionInfo | null {
    const order = this.chatSessions.get(chatId.trim());
    if (!order?.length) return null;
    return this.get(order[0]!);
  }

  /** Oldest session for a chat with the given source (agent vs user tab). */
  getPrimaryForSource(chatId: string, source: PtySessionSource): PtySessionInfo | null {
    const order = this.chatSessions.get(chatId.trim()) ?? [];
    for (const id of order) {
      const info = this.get(id);
      if (info?.source === source) return info;
    }
    return null;
  }

  open(input: {
    chatId: string;
    workspaceRoot: string;
    cols?: number;
    rows?: number;
    label?: string;
    source?: PtySessionSource;
    /** When false (default), reuse the primary session for this chat if it exists. */
    forceNew?: boolean;
    cwd?: string;
  }): PtySessionInfo {
    const chatId = input.chatId.trim();
    const source = input.source ?? "user";
    const forceNew = input.forceNew === true;

    const reuseKey = `${chatId}:${source}`;

    if (!forceNew) {
      const primary = this.getPrimaryForSource(chatId, source);
      if (primary) {
        const record = this.sessions.get(primary.sessionId);
        if (record) {
          const cols = Math.max(20, Math.min(500, input.cols ?? primary.cols));
          const rows = Math.max(5, Math.min(200, input.rows ?? primary.rows));
          try {
            record.pty.resize(cols, rows);
            record.info.cols = cols;
            record.info.rows = rows;
          } catch {
            /* closed */
          }
          // Keep tab titles stable on reuse (Agent shell must not become a command snippet).
          return record.info;
        }
      }
      const inflightId = this.openInflight.get(reuseKey);
      if (inflightId) {
        const inflight = this.sessions.get(inflightId);
        if (inflight) return inflight.info;
      }
    }

    const order = this.chatSessions.get(chatId) ?? [];
    if (order.length >= MAX_SESSIONS_PER_CHAT) {
      const dropId = order[0]!;
      this.close(dropId);
    }

    const workspaceRoot = path.resolve(input.workspaceRoot.trim() || process.cwd());
    const spawnCwd = input.cwd?.trim()
      ? path.resolve(input.cwd.trim())
      : workspaceRoot;
    if (input.cwd?.trim()) validateRequestedCwd(spawnCwd);
    const cols = Math.max(20, Math.min(500, input.cols ?? 80));
    const rows = Math.max(5, Math.min(200, input.rows ?? 24));
    const index = (this.chatSessions.get(chatId) ?? []).length;
    const label = input.label?.trim() || defaultLabel(source, index);

    const sessionId = newSessionId(chatId);
    if (!forceNew) {
      this.openInflight.set(reuseKey, sessionId);
    }
    try {
    const launch = buildInteractivePtyLaunch();
    const shell = launch.executable;
    const args = launch.args.length > 0 ? launch.args : undefined;
    const env = {
      ...terminalEnvironment(shell, launch.env),
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      LIMINAL_CHAT_ID: chatId,
      LIMINAL_WORKSPACE_ROOT: workspaceRoot,
      LIMINAL_PTY_SESSION: sessionId,
    };

    const proc = pty.spawn(shell, args ?? [], {
      name: "xterm-256color",
      cols,
      rows,
      cwd: spawnCwd,
      env: env as Record<string, string>,
      useConpty: process.platform === "win32",
    });

    const info: PtySessionInfo = {
      sessionId,
      chatId,
      workspaceRoot,
      cols,
      rows,
      cwd: spawnCwd,
      label,
      source,
      createdAt: Date.now(),
    };

    const record: PtySessionRecord = {
      info,
      pty: proc,
      sockets: new Set(),
      outputBacklog: "",
      dataListeners: new Set(),
    };

    proc.onData(data => this.publishData(record, data));
    proc.onExit(({ exitCode }) => this.releaseSession(record, exitCode));

    this.sessions.set(sessionId, record);
    const nextOrder = [...(this.chatSessions.get(chatId) ?? []), sessionId];
    this.chatSessions.set(chatId, nextOrder);
    if (!forceNew) {
      this.openInflight.delete(reuseKey);
    }
    this.emit("open", info);
    return info;
    } catch (err) {
      if (!forceNew) {
        this.openInflight.delete(reuseKey);
      }
      throw err;
    }
  }

  /**
   * Run a single command in a short-lived PTY. The shell process exits when the
   * command completes — exit code comes from `onExit`, not injected markers.
   */
  runOneshot(input: PtyOneshotInput): Promise<PtyOneshotResult> {
    if (input.signal?.aborted) return Promise.reject(new Error("Terminal command cancelled before execution."));
    const chatId = input.chatId.trim();
    const workspaceRoot = path.resolve(input.workspaceRoot.trim() || process.cwd());
    const spawnCwd = input.cwd?.trim()
      ? path.resolve(input.cwd.trim())
      : workspaceRoot;
    if (input.cwd?.trim()) validateRequestedCwd(spawnCwd);
    const cols = Math.max(20, Math.min(500, input.cols ?? 80));
    const rows = Math.max(5, Math.min(200, input.rows ?? 24));
    const label = input.label?.trim() || truncateCommandLabel(input.command);
    const { executable, args } = buildOneshotPtyLaunch(input.command, spawnCwd);

    const sessionId = newSessionId(chatId);
    const env = {
      ...terminalEnvironment(executable),
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      LIMINAL_CHAT_ID: chatId,
      LIMINAL_WORKSPACE_ROOT: workspaceRoot,
      LIMINAL_PTY_SESSION: sessionId,
    };

    const proc = pty.spawn(executable, args, {
      name: "xterm-256color",
      cols,
      rows,
      cwd: spawnCwd,
      env: env as Record<string, string>,
      useConpty: process.platform === "win32",
    });

    const info: PtySessionInfo = {
      sessionId,
      chatId,
      workspaceRoot,
      cols,
      rows,
      cwd: spawnCwd,
      label,
      source: "agent",
      createdAt: Date.now(),
    };

    let output = "";
    const record: PtySessionRecord = {
      info,
      pty: proc,
      sockets: new Set(),
      outputBacklog: "",
      dataListeners: new Set(),
    };

    const appendOutput = (data: string) => {
      output += data;
      this.publishData(record, data);
      if (output.length > MAX_OUTPUT_BACKLOG) {
        output = output.slice(-MAX_OUTPUT_BACKLOG);
      }
      try { input.onData?.(data); } catch { /* observer */ }
    };

    proc.onData(appendOutput);

    this.sessions.set(sessionId, record);
    const nextOrder = [...(this.chatSessions.get(chatId) ?? []), sessionId];
    this.chatSessions.set(chatId, nextOrder);
    return new Promise<PtyOneshotResult>((resolve, reject) => {
      let settled = false;
      const finish = (result: PtyOneshotResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        input.signal?.removeEventListener("abort", onAbort);
        resolve(result);
      };
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        input.signal?.removeEventListener("abort", onAbort);
        this.releaseSession(record, -1);
        // Enumerate the owned shell tree before terminating its root. Killing
        // only the console/shell first can orphan native children on Windows.
        terminateOwnedPty(proc, () => reject(err));
      };
      const onAbort = () => fail(new Error("Terminal command cancelled."));

      const timer = setTimeout(() => {
        const tail = output.slice(-4000) || "(none)";
        fail(
          new Error(
            `Terminal command timed out after ${input.timeoutMs}ms.\nOutput tail:\n${tail}`
          )
        );
      }, input.timeoutMs);

      proc.onExit(({ exitCode }) => {
        this.releaseSession(record, exitCode);
        finish({
          exitCode,
          output: normalizePtyOutput(output),
          sessionId,
        });
      });
      input.signal?.addEventListener("abort", onAbort, { once: true });
      if (input.signal?.aborted) { onAbort(); return; }
      try {
        this.emit("open", info);
        input.onSessionStart?.(info);
      } catch (err) {
        fail(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  attachSocket(sessionId: string, socket: import("ws").WebSocket): boolean {
    const record = this.sessions.get(sessionId);
    if (!record) return false;
    record.sockets.add(socket);
    if (record.outputBacklog.length > 0 && socket.readyState === socket.OPEN) {
      socket.send(record.outputBacklog);
    }
    socket.on("message", (raw) => {
      const data = typeof raw === "string" ? raw : Buffer.from(raw as ArrayBuffer).toString("utf8");
      try {
        record.pty.write(data);
      } catch {
        /* closed */
      }
    });
    socket.on("close", () => {
      record.sockets.delete(socket);
    });
    return true;
  }

  isAlive(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  readTail(sessionId: string, chars: number): string {
    const record = this.sessions.get(sessionId);
    if (!record) return "";
    const n = Math.max(0, Math.min(MAX_OUTPUT_BACKLOG, chars));
    return record.outputBacklog.slice(-n);
  }

  onSessionData(sessionId: string, listener: (chunk: string) => void): () => void {
    const record = this.sessions.get(sessionId);
    if (!record) return () => undefined;
    record.dataListeners.add(listener);
    return () => {
      record.dataListeners.delete(listener);
    };
  }

  write(sessionId: string, data: string): boolean {
    const record = this.sessions.get(sessionId);
    if (!record) return false;
    try {
      record.pty.write(data);
      return true;
    } catch {
      return false;
    }
  }

  resize(sessionId: string, cols: number, rows: number): boolean {
    const record = this.sessions.get(sessionId);
    if (!record) return false;
    const c = Math.max(20, Math.min(500, cols));
    const r = Math.max(5, Math.min(200, rows));
    try {
      record.pty.resize(c, r);
      record.info.cols = c;
      record.info.rows = r;
      return true;
    } catch {
      return false;
    }
  }

  close(sessionId: string): boolean {
    const record = this.sessions.get(sessionId);
    if (!record) return false;
    try { record.pty.kill(); } catch { /* already exited */ }
    this.releaseSession(record, -1);
    return true;
  }

  cancelForeground(sessionId: string): Promise<void> {
    const record = this.sessions.get(sessionId);
    if (!record) return Promise.resolve();
    this.releaseSession(record, -1);
    return new Promise((resolve) => terminateOwnedPty(record.pty, resolve));
  }

  closeForChat(chatId: string): void {
    for (const sessionId of [...(this.chatSessions.get(chatId.trim()) ?? [])]) {
      this.close(sessionId);
    }
    this.chatSessions.delete(chatId.trim());
  }

  disposeAll(): void {
    for (const sessionId of [...this.sessions.keys()]) {
      this.close(sessionId);
    }
    this.chatSessions.clear();
  }

  hostLabel(): string {
    return `${os.hostname()} · ${process.platform}`;
  }
}

function truncateCommandLabel(command: string, max = 48): string {
  const one = command.replace(/\s+/g, " ").trim();
  return one.length <= max ? one : `${one.slice(0, max - 1)}…`;
}

/** Strip common interactive-shell noise from captured one-shot output. */
function normalizePtyOutput(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .trimEnd();
}
