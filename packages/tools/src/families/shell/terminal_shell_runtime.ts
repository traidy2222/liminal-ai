/**
 * Terminal-backed run_shell / run_background runtime.
 *
 * PowerShell foreground commands use owned noninteractive PTYs and actual
 * process exit status. Other interactive shells use agent_shell_session.ts.
 * Background tabs and explicit interactive sessions keep their existing ports.
 */
import type { AgentHarness, RuntimePreferences, ToolResult } from "@liminal/core";
import { effectiveHarnessEnvRaw, resolveHarnessEnvRaw, resolveShellRuntime, writeArtifact } from "@liminal/core";
import { createHash } from "node:crypto";
import {
  buildHumanShellInput,
  buildShellCommandLine,
  getAgentShellSession,
  enqueueAgentShell,
  resetAgentShellSessionsForTests,
  startAgentTerminalWarmup,
  waitForShellBoot,
  waitForStablePrompt,
} from "./agent_shell_session.js";
import { getPtyShellPort, type PtyManagerPort } from "./pty_shell_port.js";
import { capShellToolOutput } from "./shell_tool_output.js";
import { normalizeNewlines, stripAnsi } from "./shell_prompt.js";
import { ensureChatTerminal, publishTerminalView } from "./terminal_runtime.js";

export {
  buildHumanShellInput,
  buildShellCommandLine,
  startAgentTerminalWarmup,
  waitForShellBoot,
  waitForStablePrompt,
  recoverShellToPrompt,
} from "./agent_shell_session.js";

const MAX_CAPTURE = 512 * 1024;

function waitForForegroundCommand(pending: Promise<ToolResult>, signal: AbortSignal | undefined, started: () => boolean): Promise<ToolResult> {
  if (!signal) return pending;
  return new Promise((resolve) => {
    const finish = (result: ToolResult) => { signal.removeEventListener("abort", onAbort); resolve(result); };
    const onAbort = () => { if (!started()) finish({ ok: false, error: "Terminal command cancelled." }); };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    void pending.then(finish, (err) => finish({ ok: false, error: err instanceof Error ? err.message : String(err) }));
  });
}

export interface TerminalBackgroundJob {
  sessionId: string;
  chatId: string;
  command: string;
  cwd?: string;
  label: string;
  startedAt: number;
}

const backgroundJobs = new Map<string, TerminalBackgroundJob>();

/** Test-only: clear per-chat queues and boot caches between cases. */
export function resetTerminalShellRuntimeForTests(): void {
  backgroundJobs.clear();
  resetAgentShellSessionsForTests();
}

export function shellUseUiPty(prefs?: RuntimePreferences | null): boolean {
  if (!getPtyShellPort()) return false;
  return resolveHarnessEnvRaw("AGENT_SHELL_USE_UI_PTY", prefs ?? null) !== "0";
}

function lineEnding(): string {
  return process.platform === "win32" ? "\r\n" : "\n";
}

/** Plain command line for a visible terminal tab (optional cwd prefix). */
export function wrapPlainCommand(command: string, cwd?: string): string {
  return `${buildShellCommandLine(command, cwd)}${lineEnding()}`;
}

/**
 * @deprecated Exit codes come from OSC 133 markers (or a probe on cmd.exe);
 * no exit suffix is appended to commands anymore. Same as wrapPlainCommand.
 */
export function wrapPlainCommandWithExit(command: string, cwd?: string): string {
  return wrapPlainCommand(command, cwd);
}

/** Write a long-running command into an interactive PTY tab (no exit suffix). */
export function wrapBackgroundCommand(command: string, cwd?: string): string {
  return wrapPlainCommand(command, cwd);
}

/** @deprecated Use waitForShellBoot (marker-aware). */
export async function waitForShellReady(
  port: PtyManagerPort,
  sessionId: string,
  timeoutMs = 15_000
): Promise<void> {
  return waitForStablePrompt(port, sessionId, {
    timeoutMs,
    requireMinBytes: false,
  });
}

function truncateLabel(command: string, max = 48): string {
  const one = command.replace(/\s+/g, " ").trim();
  return one.length <= max ? one : `${one.slice(0, max - 1)}…`;
}

function backgroundTabLabel(command: string): string {
  return `bg · ${truncateLabel(command, 36)}`;
}

async function openDedicatedTerminalTab(
  port: PtyManagerPort,
  chatId: string,
  opts: { label: string; cwd?: string; focus?: boolean }
): Promise<{ sessionId: string; label: string; cwd: string } | null> {
  const viaEnsure = await ensureChatTerminal({
    chatId,
    label: opts.label,
    source: "agent",
    forceNew: true,
    cwd: opts.cwd,
    focus: opts.focus ?? true,
  });
  if (viaEnsure) return viaEnsure;
  return port.ensure({
    chatId,
    label: opts.label,
    source: "agent",
    forceNew: true,
    cwd: opts.cwd,
    focus: opts.focus ?? true,
  });
}

function formatShellResultBody(raw: string): string {
  return capShellToolOutput(raw.trimEnd() || "(no output)");
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

export async function runShellInTerminal(input: {
  harness: AgentHarness;
  command: string;
  cwd?: string;
  timeoutMs: number;
  cappedNote: string;
  onChunk?: (chunk: string) => void;
  signal?: AbortSignal;
}): Promise<ToolResult> {
  if (input.signal?.aborted) return { ok: false, error: "Terminal command cancelled before execution." };
  const chatId = input.harness.taskId?.trim();
  if (!chatId) {
    return { ok: false, error: "No chat context for terminal shell execution." };
  }
  if (!getPtyShellPort()) {
    return { ok: false, error: "PTY shell port is not available." };
  }

  const runtime = resolveShellRuntime();
  if (runtime.kind === "powershell" || runtime.kind === "pwsh") {
    // Foreground commands are noninteractive jobs. Sending a multiline paste
    // through PSReadLine can accept a repainted/empty prompt as completion and
    // return stale output while the actual command is still being entered.
    let commandStarted = false;
    const pending = enqueueAgentShell<ToolResult>(chatId, async () => {
      if (input.signal?.aborted) return { ok: false, error: "Terminal command cancelled before execution." };
      const port = getPtyShellPort();
      if (!port) return { ok: false, error: "PTY shell port is not available." };
      try {
        commandStarted = true;
        const result = await port.runOneshot({ chatId, command: input.command, cwd: input.cwd,
          timeoutMs: input.timeoutMs, label: "Agent command", onData: input.onChunk,
          signal: input.signal,
          onSessionStart: info => {
            try {
              publishTerminalView({chatId, ...info, source: "agent", open: true, focus: true, updatedAt: Date.now()});
            } catch { /* A UI observer must not fail or replay an executing job. */ }
          },
        });
        if (input.signal?.aborted) return { ok: false, error: "Terminal command cancelled." };
        const captured = normalizeNewlines(stripAnsi(result.output)).trimEnd() || "(no output)";
        let preview = formatShellResultBody(captured);
        if (preview !== captured) {
          // Completed job tabs close; omitted text must remain retrievable.
          // Archiving failure must never cause a completed command to replay.
          try {
            const hash = createHash("sha256").update(captured).digest("hex");
            const pointer = await writeArtifact(hash, captured);
            preview = preview.replaceAll("see Terminal panel for full scrollback", "read saved output below")
              .replaceAll("full output in Terminal panel", "read saved output below") +
              `\nFull command output: ${pointer}\nread_artifact hash=${hash}`;
          } catch {
            preview = captured + "\n[Output archive unavailable; complete captured output is returned above. Do not repeat the command for this.]";
          }
        }
        const body = (input.cappedNote ?? "") + preview;
        return result.exitCode === 0 ? { ok: true, output: body } : { ok: false, error: `Exit code ${result.exitCode}.\n${body}` };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    });
    return waitForForegroundCommand(pending, input.signal, () => commandStarted);
  }

  return getAgentShellSession(chatId).exec({
    command: input.command,
    cwd: input.cwd,
    timeoutMs: input.timeoutMs,
    cappedNote: input.cappedNote,
    signal: input.signal,
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

  const label = backgroundTabLabel(input.command);
  const session = await openDedicatedTerminalTab(port, chatId, {
    label,
    cwd: input.cwd,
    focus: true,
  });
  if (!session) {
    return { ok: false, error: "Failed to open terminal tab for background command." };
  }

  try {
    await waitForShellBoot(port, session.sessionId);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const baselineLen = port.readTail(session.sessionId, MAX_CAPTURE).length;
  const payload = buildHumanShellInput(input.command, input.cwd);
  if (!port.write(session.sessionId, payload)) {
    return { ok: false, error: "Failed to start command in terminal." };
  }

  await sleep(input.startupWaitMs);

  const tail = port.readTail(session.sessionId, MAX_CAPTURE);
  const initial = formatShellResultBody(
    (tail.length > baselineLen ? tail.slice(baselineLen) : tail).slice(0, 4000)
  );
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

  const output = formatShellResultBody(port.readTail(sessionId, tailChars));
  const status = alive ? "running" : "exited";
  if (!alive) backgroundJobs.delete(sessionId);

  let healthLine = "";
  if (effectiveHarnessEnvRaw("AGENT_PROCESS_HEALTH") === "1" && healthUrl) {
    healthLine = await probeHealth(healthUrl);
  }

  return {
    ok: true,
    output: `session_id: ${sessionId} [${status}]\n${output}${healthLine}`,
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

export async function terminalPtySend(
  sessionId: string,
  input: string,
  appendNewline: boolean
): Promise<ToolResult> {
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
