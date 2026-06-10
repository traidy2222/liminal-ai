import type { AgentHarness, RuntimePreferences, ToolResult } from "@liminal/core";
import { effectiveHarnessEnvRaw, resolveHarnessEnvRaw } from "@liminal/core";
import { getPtyShellPort, type PtyManagerPort } from "./pty_shell_port.js";
import { ensureChatTerminal } from "./terminal_runtime.js";

export const LIMINAL_EXIT_MARKER = "__LIMINAL_EXIT_";
const EXIT_RE = /__LIMINAL_EXIT_(\d+)__/;
const MAX_CAPTURE = 512 * 1024;

export interface TerminalBackgroundJob {
  sessionId: string;
  chatId: string;
  command: string;
  cwd?: string;
  label: string;
  startedAt: number;
}

const backgroundJobs = new Map<string, TerminalBackgroundJob>();
const sessionQueues = new Map<string, Promise<unknown>>();

export function shellUseUiPty(prefs?: RuntimePreferences | null): boolean {
  if (!getPtyShellPort()) return false;
  return resolveHarnessEnvRaw("AGENT_SHELL_USE_UI_PTY", prefs ?? null) !== "0";
}

function lineEnding(): string {
  return process.platform === "win32" ? "\r\n" : "\n";
}

function shellQuotePath(p: string): string {
  if (process.platform === "win32") {
    return `'${p.replace(/'/g, "''")}'`;
  }
  return `'${p.replace(/'/g, "'\\''")}'`;
}

/** Wrap a one-shot command so we can detect completion + exit code in an interactive PTY. */
export function wrapOneshotCommand(command: string, cwd?: string): string {
  const eol = lineEnding();
  if (process.platform === "win32") {
    const cd = cwd?.trim() ? `Set-Location -LiteralPath ${shellQuotePath(cwd.trim())}; ` : "";
    return `${cd}try { ${command} } finally { Write-Host "${LIMINAL_EXIT_MARKER}$LASTEXITCODE__" }${eol}`;
  }
  const cd = cwd?.trim() ? `cd ${shellQuotePath(cwd.trim())} && ` : "";
  return `${cd}(${command}); echo ${LIMINAL_EXIT_MARKER}$?__${eol}`;
}

export function wrapBackgroundCommand(command: string, cwd?: string): string {
  const eol = lineEnding();
  if (process.platform === "win32") {
    const cd = cwd?.trim() ? `Set-Location -LiteralPath ${shellQuotePath(cwd.trim())}; ` : "";
    return `${cd}${command}${eol}`;
  }
  const cd = cwd?.trim() ? `cd ${shellQuotePath(cwd.trim())} && ` : "";
  return `${cd}${command}${eol}`;
}

function truncateLabel(command: string, max = 48): string {
  const one = command.replace(/\s+/g, " ").trim();
  return one.length <= max ? one : `${one.slice(0, max - 1)}…`;
}

function enqueueSession<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
  const prev = sessionQueues.get(sessionId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  sessionQueues.set(
    sessionId,
    next.catch(() => undefined)
  );
  return next;
}

function pruneDeadJobs(port: PtyManagerPort): void {
  for (const [sessionId] of backgroundJobs) {
    if (!port.isAlive(sessionId)) {
      backgroundJobs.delete(sessionId);
    }
  }
}

export function listTerminalBackgroundJobs(chatId?: string): TerminalBackgroundJob[] {
  const port = getPtyShellPort();
  if (port) pruneDeadJobs(port);
  const all = [...backgroundJobs.values()];
  if (!chatId) return all;
  return all.filter((j) => j.chatId === chatId);
}

export function getTerminalBackgroundJob(sessionId: string): TerminalBackgroundJob | null {
  return backgroundJobs.get(sessionId) ?? null;
}

async function ensureAgentShell(
  port: PtyManagerPort,
  chatId: string,
  opts?: { label?: string; cwd?: string; forceNew?: boolean; focus?: boolean }
): Promise<{ sessionId: string; label: string; cwd: string } | null> {
  const viaEnsure = await ensureChatTerminal({
    chatId,
    label: opts?.label ?? "Agent shell",
    source: "agent",
    forceNew: opts?.forceNew,
    cwd: opts?.cwd,
    focus: opts?.focus ?? false,
  });
  if (viaEnsure) return viaEnsure;
  return port.ensure({
    chatId,
    label: opts?.label ?? "Agent shell",
    source: "agent",
    forceNew: opts?.forceNew,
    cwd: opts?.cwd,
    focus: opts?.focus ?? false,
  });
}

export async function waitForExitMarker(
  port: PtyManagerPort,
  sessionId: string,
  timeoutMs: number,
  baselineLen: number,
  onChunk?: (chunk: string) => void
): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve, reject) => {
    let captured = port.readTail(sessionId, MAX_CAPTURE);
    if (captured.length > baselineLen) {
      captured = captured.slice(baselineLen);
    } else {
      captured = "";
    }

    const finish = (exitCode: number, output: string) => {
      clearTimeout(timer);
      unsub();
      const cleaned = output.replace(EXIT_RE, "").trimEnd();
      resolve({ exitCode, output: cleaned });
    };

    const tryMatch = () => {
      const m = captured.match(EXIT_RE);
      if (m) finish(parseInt(m[1]!, 10), captured);
    };

    tryMatch();

    const unsub = port.onData(sessionId, (chunk) => {
      captured += chunk;
      if (captured.length > MAX_CAPTURE) captured = captured.slice(-MAX_CAPTURE);
      onChunk?.(chunk);
      tryMatch();
    });

    const timer = setTimeout(() => {
      unsub();
      reject(
        new Error(
          `Terminal command timed out after ${timeoutMs}ms.\nOutput tail:\n${captured.slice(-4000) || "(none)"}`
        )
      );
    }, timeoutMs);
  });
}

export async function runShellInTerminal(input: {
  harness: AgentHarness;
  command: string;
  cwd?: string;
  timeoutMs: number;
  cappedNote: string;
  onChunk?: (chunk: string) => void;
}): Promise<ToolResult> {
  const port = getPtyShellPort();
  if (!port) {
    return { ok: false, error: "PTY shell port is not available." };
  }
  const chatId = input.harness.taskId?.trim();
  if (!chatId) {
    return { ok: false, error: "No chat context for terminal shell execution." };
  }

  const session = await ensureAgentShell(port, chatId, {
    label: truncateLabel(input.command),
    cwd: input.cwd,
    focus: false,
  });
  if (!session) {
    return { ok: false, error: "Failed to open agent terminal session." };
  }

  return enqueueSession(session.sessionId, async () => {
    const baselineLen = port.readTail(session.sessionId, MAX_CAPTURE).length;
    const payload = wrapOneshotCommand(input.command, input.cwd);
    if (!port.write(session.sessionId, payload)) {
      return { ok: false, error: "Failed to write command to terminal session." };
    }

    try {
      const { exitCode, output } = await waitForExitMarker(
        port,
        session.sessionId,
        input.timeoutMs,
        baselineLen,
        input.onChunk
      );
      const body = output.trimEnd() || "(no output)";
      const full = input.cappedNote + body;
      if (exitCode !== 0) {
        if (body.length >= 120) {
          return {
            ok: true,
            output: `[exit ${exitCode} — output captured; treat as diagnostic]\n${full}`,
          };
        }
        return { ok: false, error: `Exit code ${exitCode}.\n${full}` };
      }
      return { ok: true, output: full };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });
}

export async function runBackgroundInTerminal(input: {
  harness: AgentHarness;
  command: string;
  cwd?: string;
  startupWaitMs: number;
}): Promise<ToolResult> {
  const port = getPtyShellPort();
  if (!port) {
    return { ok: false, error: "PTY shell port is not available." };
  }
  const chatId = input.harness.taskId?.trim();
  if (!chatId) {
    return { ok: false, error: "No chat context for terminal background execution." };
  }

  const label = truncateLabel(input.command);
  const session = await ensureAgentShell(port, chatId, {
    label,
    cwd: input.cwd,
    forceNew: true,
    focus: true,
  });
  if (!session) {
    return { ok: false, error: "Failed to open terminal tab for background command." };
  }

  const baselineLen = port.readTail(session.sessionId, MAX_CAPTURE).length;
  const payload = wrapBackgroundCommand(input.command, input.cwd);
  if (!port.write(session.sessionId, payload)) {
    return { ok: false, error: "Failed to start command in terminal." };
  }

  await sleep(input.startupWaitMs);

  const tail = port.readTail(session.sessionId, MAX_CAPTURE);
  const initial = (tail.length > baselineLen ? tail.slice(baselineLen) : tail).slice(0, 800).trim();
  const alive = port.isAlive(session.sessionId);

  if (!alive) {
    backgroundJobs.delete(session.sessionId);
    return {
      ok: false,
      error: `Process exited immediately in terminal.\nOutput: ${initial || "(none)"}`,
    };
  }

  const job: TerminalBackgroundJob = {
    sessionId: session.sessionId,
    chatId,
    command: input.command,
    cwd: input.cwd,
    label,
    startedAt: Date.now(),
  };
  backgroundJobs.set(session.sessionId, job);

  return {
    ok: true,
    output:
      `session_id: ${session.sessionId} | Status: running | Terminal: ${label}\n` +
      `cwd: ${session.cwd}\n` +
      `Watch live output in the Terminal panel (tab "${label}").\n` +
      `Initial output:\n${initial || "(none yet — may still be starting)"}`,
  };
}

export async function readTerminalOutput(
  sessionId: string,
  tailChars: number,
  healthUrl?: string
): Promise<ToolResult> {
  const port = getPtyShellPort();
  if (!port) {
    return { ok: false, error: "PTY shell port is not available." };
  }
  const alive = port.isAlive(sessionId);
  if (!alive && !backgroundJobs.has(sessionId)) {
    return {
      ok: false,
      error: `No terminal session ${sessionId}. Use list_processes or check the Terminal panel.`,
    };
  }

  const output = port.readTail(sessionId, tailChars).trim();
  const status = alive ? "running" : "exited";
  if (!alive) backgroundJobs.delete(sessionId);

  let healthLine = "";
  if (effectiveHarnessEnvRaw("AGENT_PROCESS_HEALTH") === "1" && healthUrl) {
    healthLine = await probeHealth(healthUrl);
  }

  return {
    ok: true,
    output: `session_id: ${sessionId} [${status}]\n${output || "(no output yet)"}${healthLine}`,
  };
}

export async function killTerminalSession(sessionId: string): Promise<ToolResult> {
  const port = getPtyShellPort();
  const job = backgroundJobs.get(sessionId);
  if (!port) {
    return { ok: false, error: "PTY shell port is not available." };
  }
  if (!port.isAlive(sessionId)) {
    backgroundJobs.delete(sessionId);
    return {
      ok: true,
      output: `Terminal session ${sessionId} had already exited.`,
    };
  }

  const cmd = job?.command.slice(0, 60) ?? sessionId;
  const ok = port.close(sessionId);
  backgroundJobs.delete(sessionId);
  if (!ok) {
    return { ok: true, output: `Terminal session ${sessionId} had already exited.` };
  }
  return { ok: true, output: `Closed terminal session ${sessionId} (${cmd})` };
}

export function listTerminalJobsForChat(chatId: string): ToolResult {
  const port = getPtyShellPort();
  if (!port) {
    return { ok: true, output: "(no terminal background jobs — PTY runtime unavailable)" };
  }
  pruneDeadJobs(port);
  const jobs = listTerminalBackgroundJobs(chatId);
  if (jobs.length === 0) {
    return { ok: true, output: "(no background terminal sessions)" };
  }
  const lines = jobs.map((j) => {
    const age = Math.round((Date.now() - j.startedAt) / 1000);
    const alive = port.isAlive(j.sessionId);
    const status = alive ? "running" : "exited";
    return `session_id ${j.sessionId} [${status}] ${age}s — ${j.command.slice(0, 70)}${j.cwd ? ` (cwd: ${j.cwd})` : ""}`;
  });
  return { ok: true, output: lines.join("\n") };
}

export async function terminalPtySend(sessionId: string, input: string, appendNewline: boolean): Promise<ToolResult> {
  const port = getPtyShellPort();
  if (!port) return { ok: false, error: "PTY shell port is not available." };
  if (!port.isAlive(sessionId)) {
    return { ok: false, error: `Session ${sessionId} is not running.` };
  }
  const data = appendNewline ? `${input}${lineEnding()}` : input;
  if (!port.write(sessionId, data)) {
    return { ok: false, error: `Failed to write to session ${sessionId}.` };
  }
  return { ok: true, output: `Sent ${input.length} chars to ${sessionId}.` };
}

export function terminalPtyRead(sessionId: string, tailChars: number): ToolResult {
  const port = getPtyShellPort();
  if (!port) return { ok: false, error: "PTY shell port is not available." };
  const tail = port.readTail(sessionId, tailChars).trim();
  const status = port.isAlive(sessionId) ? "running" : "exited";
  return { ok: true, output: `Session ${sessionId} [${status}]\n${tail || "(no output yet)"}` };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function probeHealth(url: string): Promise<string> {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 3_000);
    const r = await fetch(url, { method: "GET", signal: ac.signal });
    clearTimeout(t);
    return `\nHealth probe: GET ${url} → HTTP ${r.status}`;
  } catch (e) {
    return `\nHealth probe: GET ${url} → failed (${String(e).slice(0, 120)})`;
  }
}
