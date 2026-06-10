import { EventEmitter } from "node:events";
import os from "node:os";
import path from "node:path";
import * as pty from "node-pty";

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

function defaultShell(): string {
  if (process.platform === "win32") {
    return process.env.ComSpec?.trim() || "powershell.exe";
  }
  return process.env.SHELL?.trim() || "/bin/bash";
}

function shellArgs(shell: string): string[] | undefined {
  const base = path.basename(shell).toLowerCase();
  if (base === "powershell.exe" || base === "pwsh.exe" || base === "powershell") {
    return ["-NoLogo"];
  }
  if (base === "bash" || base === "zsh" || base === "fish") {
    return ["-l"];
  }
  return undefined;
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

    if (!forceNew) {
      const primary = this.getPrimary(chatId);
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
          if (input.label?.trim()) record.info.label = input.label.trim();
          return record.info;
        }
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
    const cols = Math.max(20, Math.min(500, input.cols ?? 80));
    const rows = Math.max(5, Math.min(200, input.rows ?? 24));
    const index = (this.chatSessions.get(chatId) ?? []).length;
    const label = input.label?.trim() || defaultLabel(source, index);

    const sessionId = newSessionId(chatId);
    const shell = defaultShell();
    const args = shellArgs(shell);
    const env = {
      ...process.env,
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

    proc.onData((data) => {
      record.outputBacklog += data;
      if (record.outputBacklog.length > MAX_OUTPUT_BACKLOG) {
        record.outputBacklog = record.outputBacklog.slice(-MAX_OUTPUT_BACKLOG);
      }
      this.emit("data", sessionId, chatId, data);
      for (const listener of record.dataListeners) {
        try {
          listener(data);
        } catch {
          /* ignore */
        }
      }
      for (const socket of record.sockets) {
        if (socket.readyState === socket.OPEN) {
          socket.send(data);
        }
      }
    });

    proc.onExit(({ exitCode }) => {
      this.emit("exit", sessionId, chatId, exitCode);
      for (const socket of record.sockets) {
        try {
          socket.close(1000, "pty_exit");
        } catch {
          /* ignore */
        }
      }
      record.sockets.clear();
      this.sessions.delete(sessionId);
      const ids = this.chatSessions.get(chatId) ?? [];
      this.chatSessions.set(
        chatId,
        ids.filter((id) => id !== sessionId)
      );
      if (this.chatSessions.get(chatId)?.length === 0) {
        this.chatSessions.delete(chatId);
      }
    });

    this.sessions.set(sessionId, record);
    const nextOrder = [...(this.chatSessions.get(chatId) ?? []), sessionId];
    this.chatSessions.set(chatId, nextOrder);
    this.emit("open", info);
    return info;
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
    const chatId = record.info.chatId;
    try {
      record.pty.kill();
    } catch {
      /* ignore */
    }
    this.sessions.delete(sessionId);
    const ids = this.chatSessions.get(chatId) ?? [];
    this.chatSessions.set(
      chatId,
      ids.filter((id) => id !== sessionId)
    );
    if (this.chatSessions.get(chatId)?.length === 0) {
      this.chatSessions.delete(chatId);
    }
    return true;
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
