/**
 * Harness-owned Agent shell: one PTY per chat, one stdin write per command.
 * Input uses bracketed paste (like a human paste + Enter).
 *
 * Completion detection is marker-first: core injects OSC 133 shell integration
 * at PTY launch (core/shell_integration_launch.ts), so the shell itself reports
 * "prompt painted" (A/B) and "command finished with exit code N" (D) as
 * invisible escape sequences. The harness just types the command and waits for
 * the D marker — no prompt regexes, no idle timers, no exit-code probe typed
 * into the terminal. PowerShell/bash/zsh carry the exit code on the marker;
 * cmd.exe emits A/B only, so it keeps a probe. Shells without integration
 * (fish, exotic setups) fall back to the legacy PromptDetector heuristics in
 * shell_prompt.ts.
 */
import type { ToolResult } from "@liminal/core";
import { effectiveHarnessEnvRaw } from "@liminal/core";
import { getPtyShellPort, type PtyManagerPort } from "./pty_shell_port.js";
import { Osc133Tracker, stripEchoedCommand, type Osc133Event } from "./shell_integration.js";
import {
  PromptDetector,
  buildExitProbe,
  detectShellFlavor,
  evaluateCommandCompletion,
  extractCommandOutput,
  normalizeNewlines,
  parseExitProbeValue,
  stripAnsi,
} from "./shell_prompt.js";
import { capShellToolOutput } from "./shell_tool_output.js";
import { ensureChatTerminal } from "./terminal_runtime.js";

const MAX_CAPTURE = 512 * 1024;
/** Prompt checks only need the end of the stream — never re-scan the full backlog. */
const PROMPT_CHECK_TAIL_CHARS = 4096;
const SHELL_READY_POLL_MS = 75;
const SHELL_READY_TIMEOUT_MS = 15_000;
const SHELL_MIN_BOOT_BYTES = 8;
const EXIT_PROBE_TIMEOUT_MS = 8_000;
/** Between commands the prompt is already painted — a short stability window is enough. */
const IDLE_STABLE_MS = 200;
const RECOVER_TO_PROMPT_MS = 8_000;

const chatQueues = new Map<string, Promise<unknown>>();
const sessions = new Map<string, AgentShellSession>();

export interface AgentShellExecOptions {
  command: string;
  cwd?: string;
  timeoutMs: number;
  cappedNote?: string;
}

interface SessionHandle {
  sessionId: string;
  label: string;
  cwd: string;
}

function shellBootTimeoutMs(): number {
  const raw = effectiveHarnessEnvRaw("AGENT_SHELL_BOOT_TIMEOUT_MS")?.trim();
  const n = parseInt(raw ?? "45000", 10);
  return Number.isFinite(n) && n > 0 ? n : 45_000;
}

function shellPromptStableMs(): number {
  const raw = effectiveHarnessEnvRaw("AGENT_SHELL_PROMPT_STABLE_MS")?.trim();
  const n = parseInt(raw ?? "600", 10);
  return Number.isFinite(n) && n > 0 ? n : 600;
}

function shellPromptIdleMs(): number {
  const raw = effectiveHarnessEnvRaw("AGENT_SHELL_PROMPT_IDLE_MS")?.trim();
  const n = parseInt(raw ?? "350", 10);
  return Number.isFinite(n) && n > 0 ? n : 350;
}

/** Boot fallback: a shell that printed output and then went silent is at a prompt,
 * even when its (custom) prompt matches no regex. */
function shellBootIdleFallbackMs(): number {
  const raw = effectiveHarnessEnvRaw("AGENT_SHELL_BOOT_IDLE_FALLBACK_MS")?.trim();
  const n = parseInt(raw ?? "3000", 10);
  return Number.isFinite(n) && n > 0 ? n : 3_000;
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function enqueueAgentShell<T>(chatId: string, fn: () => Promise<T>): Promise<T> {
  const key = chatId.trim();
  const prev = chatQueues.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  chatQueues.set(
    key,
    next.catch(() => undefined)
  );
  return next;
}

export function resetAgentShellSessionsForTests(): void {
  chatQueues.clear();
  sessions.clear();
}

export function getAgentShellSession(chatId: string): AgentShellSession {
  const key = chatId.trim();
  let session = sessions.get(key);
  if (!session) {
    session = new AgentShellSession(key);
    sessions.set(key, session);
  }
  return session;
}

/** Begin opening + booting the Agent shell (tool_start hook). */
export function startAgentTerminalWarmup(chatId: string): Promise<void> {
  return getAgentShellSession(chatId).warmup();
}

/** The logical command line as the shell will see it (cwd prefix included). */
export function buildShellCommandLine(command: string, cwd?: string): string {
  const flavor = detectShellFlavor();
  let line = command.trim();
  if (cwd?.trim()) {
    if (flavor === "cmd") {
      line = `cd /d "${cwd.trim().replace(/"/g, '""')}" && ${line}`;
    } else if (flavor === "powershell") {
      line = `Set-Location -LiteralPath ${shellQuotePath(cwd.trim())}; ${line}`;
    } else {
      line = `cd ${shellQuotePath(cwd.trim())} && ${line}`;
    }
  }
  return line.replace(/\x1b/g, "");
}

/**
 * One stdin chunk: bracketed paste + newline — exactly what the user sees typed.
 * cmd.exe has no bracketed paste (conhost line input), so it gets plain text with
 * inner newlines joined.
 */
export function buildHumanShellInput(command: string, cwd?: string): string {
  const eol = lineEnding();
  const safe = buildShellCommandLine(command, cwd);
  if (detectShellFlavor() === "cmd") {
    return `${safe.replace(/\r?\n/g, " & ")}${eol}`;
  }
  return `\x1b[200~${safe}\x1b[201~${eol}`;
}

export interface StablePromptOptions {
  timeoutMs?: number;
  stableMs?: number;
  minBytes?: number;
  requireMinBytes?: boolean;
  detector?: PromptDetector;
  /** Cancels the wait (cleans up timers/subscriptions and rejects). */
  signal?: AbortSignal;
  /**
   * Resolve after this much output silence even without a recognizable prompt
   * (custom prompts). Defaults on for boot-style waits (requireMinBytes), off
   * for idle waits — silence must never be mistaken for idle when a previous
   * command may still be running.
   */
  idleFallbackMs?: number;
}

/**
 * Legacy fallback: wait until the shell has produced output and held a
 * prompt-looking line steady. Used only when OSC 133 markers are unavailable.
 */
export async function waitForStablePrompt(
  port: PtyManagerPort,
  sessionId: string,
  opts?: StablePromptOptions
): Promise<void> {
  const timeoutMs = opts?.timeoutMs ?? shellBootTimeoutMs();
  const stableMs = opts?.stableMs ?? shellPromptStableMs();
  const minBytes = opts?.minBytes ?? SHELL_MIN_BOOT_BYTES;
  const requireMinBytes = opts?.requireMinBytes ?? true;
  const detector = opts?.detector ?? new PromptDetector();
  const idleFallbackMs = opts?.idleFallbackMs ?? (requireMinBytes ? shellBootIdleFallbackMs() : 0);

  return new Promise((resolve, reject) => {
    let settled = false;
    let stableTimer: ReturnType<typeof setTimeout> | null = null;
    let fallbackTimer: ReturnType<typeof setInterval> | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    let unsub: () => void = () => undefined;
    let sawMinBytes = !requireMinBytes;
    let lastDataAt = Date.now();

    const onAbort = () => fail(new Error("Cancelled."));
    const cleanup = () => {
      if (stableTimer) clearTimeout(stableTimer);
      if (fallbackTimer) clearInterval(fallbackTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      opts?.signal?.removeEventListener("abort", onAbort);
      unsub();
    };
    opts?.signal?.addEventListener("abort", onAbort, { once: true });
    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const check = () => {
      if (settled) return;
      if (!port.isAlive(sessionId)) {
        fail(new Error("Terminal session is not running."));
        return;
      }
      const plain = stripAnsi(port.readTail(sessionId, PROMPT_CHECK_TAIL_CHARS));
      if (plain.length >= minBytes) sawMinBytes = true;
      if (sawMinBytes && detector.isPromptAtEnd(plain)) {
        if (!stableTimer) stableTimer = setTimeout(finish, stableMs);
        return;
      }
      if (stableTimer) {
        clearTimeout(stableTimer);
        stableTimer = null;
      }
    };

    unsub = port.onData(sessionId, () => {
      lastDataAt = Date.now();
      check();
    });
    check();
    if (settled) {
      cleanup();
      return;
    }

    if (idleFallbackMs > 0) {
      fallbackTimer = setInterval(() => {
        if (settled) return;
        if (!port.isAlive(sessionId)) {
          fail(new Error("Terminal session is not running."));
          return;
        }
        if (sawMinBytes && Date.now() - lastDataAt >= idleFallbackMs) finish();
      }, 250);
    }

    timeoutTimer = setTimeout(() => {
      const tail = stripAnsi(port.readTail(sessionId, 4000)).slice(-1200) || "(no output yet)";
      fail(
        new Error(
          `Terminal shell not ready after ${timeoutMs}ms (waiting for stable prompt).\nOutput tail:\n${tail}`
        )
      );
    }, timeoutMs);
  });
}

/** Best-effort Ctrl+C so a stuck command does not block the next queued run_shell. */
export async function recoverShellToPrompt(
  port: PtyManagerPort,
  sessionId: string,
  detector?: PromptDetector,
  tracker?: Osc133Tracker
): Promise<void> {
  if (!port.isAlive(sessionId)) return;
  const d = detector ?? new PromptDetector();
  const eventsBefore = tracker?.lastEvent ?? null;
  port.write(sessionId, "\x03");
  const deadline = Date.now() + RECOVER_TO_PROMPT_MS;
  while (Date.now() < deadline) {
    if (!port.isAlive(sessionId)) return;
    if (tracker?.integrationActive) {
      // Recovered once a fresh prompt cycle (new B marker) has been painted.
      if (tracker.atPrompt && tracker.lastEvent !== eventsBefore) return;
    } else if (d.isPromptAtEnd(stripAnsi(port.readTail(sessionId, PROMPT_CHECK_TAIL_CHARS)))) {
      return;
    }
    await sleep(SHELL_READY_POLL_MS);
  }
}

interface CommandWaiter {
  promise: Promise<string>;
  cancel: () => void;
}

/**
 * Legacy waiter: prompt-detector heuristics over an accumulated slice.
 * Used only when OSC 133 markers are unavailable for the session.
 */
function createCommandWaiter(
  port: PtyManagerPort,
  sessionId: string,
  detector: PromptDetector,
  timeoutMs: number,
  promptIdleMs: number
): CommandWaiter {
  let settled = false;
  let buf = "";
  let sawNewline = false;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  let unsub: () => void = () => undefined;
  let resolveFn: (v: string) => void = () => undefined;
  let rejectFn: (e: Error) => void = () => undefined;

  const cleanup = () => {
    if (idleTimer) clearTimeout(idleTimer);
    if (timeoutTimer) clearTimeout(timeoutTimer);
    unsub();
  };
  const finish = (out: string) => {
    if (settled) return;
    settled = true;
    cleanup();
    resolveFn(out);
  };
  const fail = (err: Error) => {
    if (settled) return;
    settled = true;
    cleanup();
    rejectFn(err);
  };

  const tailForError = () => stripAnsi(buf).slice(-4000) || "(none)";

  const checkIdle = () => {
    if (settled) return;
    if (!port.isAlive(sessionId)) {
      fail(
        new Error(
          `Terminal session exited while the command was running.\nOutput tail:\n${tailForError()}`
        )
      );
      return;
    }
    const plainTail = stripAnsi(buf.slice(-PROMPT_CHECK_TAIL_CHARS));
    const state = evaluateCommandCompletion(plainTail, detector, { sawNewline });
    if (state === "done") {
      finish(buf);
      return;
    }
    if (state === "continuation") {
      fail(
        new Error(
          "The shell is showing a line-continuation prompt — the command line is syntactically incomplete (unbalanced quote or trailing operator). It was cancelled; fix the command and retry."
        )
      );
      return;
    }
    idleTimer = setTimeout(checkIdle, promptIdleMs);
  };

  const promise = new Promise<string>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
    unsub = port.onData(sessionId, (chunk) => {
      buf += chunk;
      if (buf.length > MAX_CAPTURE) buf = buf.slice(-MAX_CAPTURE);
      if (!sawNewline && chunk.includes("\n")) sawNewline = true;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(checkIdle, promptIdleMs);
    });
    idleTimer = setTimeout(checkIdle, promptIdleMs);
    timeoutTimer = setTimeout(() => {
      fail(
        new Error(
          `Terminal command timed out after ${timeoutMs}ms.\nOutput tail:\n${tailForError()}`
        )
      );
    }, timeoutMs);
  });

  return { promise, cancel: () => fail(new Error("Command cancelled.")) };
}

interface MarkerCommandResult {
  /** Raw output slice from write to completion marker (echo included). */
  slice: string;
  /** Exit code from the D marker; null when the shell doesn't carry it (cmd). */
  exitCode: number | null;
}

interface MarkerCommandWaiter {
  promise: Promise<MarkerCommandResult>;
  cancel: () => void;
}

/**
 * Marker waiter: command is complete when the shell emits the next OSC 133
 * completion marker — D (with exit code) on PowerShell/bash/zsh, or the next
 * prompt cycle (A…B, no code) on cmd.exe. No idle timers, no prompt regexes.
 *
 * Create BEFORE writing the command so no chunk can be missed.
 */
function createMarkerCommandWaiter(
  port: PtyManagerPort,
  sessionId: string,
  timeoutMs: number
): MarkerCommandWaiter {
  let settled = false;
  let buf = "";
  let trimmed = 0; // chars dropped from the front of buf
  let pendingA: Osc133Event | null = null;
  const tracker = new Osc133Tracker();
  let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  let aliveTimer: ReturnType<typeof setInterval> | null = null;
  let unsub: () => void = () => undefined;
  let resolveFn: (v: MarkerCommandResult) => void = () => undefined;
  let rejectFn: (e: Error) => void = () => undefined;

  const cleanup = () => {
    if (timeoutTimer) clearTimeout(timeoutTimer);
    if (aliveTimer) clearInterval(aliveTimer);
    unsub();
  };
  const finish = (v: MarkerCommandResult) => {
    if (settled) return;
    settled = true;
    cleanup();
    resolveFn(v);
  };
  const fail = (err: Error) => {
    if (settled) return;
    settled = true;
    cleanup();
    rejectFn(err);
  };

  const sliceTo = (offset: number) => buf.slice(0, Math.max(0, offset - trimmed));
  const tailForError = () => stripAnsi(buf).slice(-4000) || "(none)";

  const promise = new Promise<MarkerCommandResult>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
    unsub = port.onData(sessionId, (chunk) => {
      buf += chunk;
      if (buf.length > MAX_CAPTURE) {
        trimmed += buf.length - MAX_CAPTURE;
        buf = buf.slice(-MAX_CAPTURE);
      }
      for (const ev of tracker.feed(chunk)) {
        if (ev.kind === "D") {
          finish({ slice: sliceTo(ev.offset), exitCode: ev.exitCode });
          return;
        }
        if (ev.kind === "A") {
          pendingA = ev;
        } else if (ev.kind === "B") {
          // cmd.exe: no D marker — the next full prompt cycle means done.
          finish({ slice: sliceTo((pendingA ?? ev).offset), exitCode: null });
          return;
        }
      }
    });
    aliveTimer = setInterval(() => {
      if (!port.isAlive(sessionId)) {
        fail(
          new Error(
            `Terminal session exited while the command was running.\nOutput tail:\n${tailForError()}`
          )
        );
      }
    }, 500);
    timeoutTimer = setTimeout(() => {
      fail(
        new Error(
          `Terminal command timed out after ${timeoutMs}ms.\nOutput tail:\n${tailForError()}`
        )
      );
    }, timeoutMs);
  });

  return { promise, cancel: () => fail(new Error("Command cancelled.")) };
}

/** Wait until the session tracker reports an input prompt (B marker). */
function waitForMarkerPrompt(
  port: PtyManagerPort,
  sessionId: string,
  tracker: Osc133Tracker,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<void> {
  if (tracker.atPrompt) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    let unsub: () => void = () => undefined;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    const onAbort = () => fail(new Error("Cancelled."));
    const finish = () => {
      if (settled) return;
      settled = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      signal?.removeEventListener("abort", onAbort);
      unsub();
      resolve();
    };
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      signal?.removeEventListener("abort", onAbort);
      unsub();
      reject(err);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    // The session's persistent feed runs first (registered earlier), so the
    // tracker state is already updated when this listener fires.
    unsub = port.onData(sessionId, () => {
      if (!port.isAlive(sessionId)) {
        fail(new Error("Terminal session is not running."));
        return;
      }
      if (tracker.atPrompt) finish();
    });
    if (tracker.atPrompt) {
      finish();
      return;
    }
    timeoutTimer = setTimeout(() => {
      fail(new Error(`Shell prompt marker not seen after ${timeoutMs}ms.`));
    }, timeoutMs);
  });
}

/**
 * Probe the exit code by typing a status echo — only used for shells whose
 * markers don't carry it (cmd.exe) or legacy non-marker sessions. Never
 * throws: a failed probe degrades to "unknown" instead of failing a command
 * whose output was already captured.
 */
async function probeExitCode(
  port: PtyManagerPort,
  sessionId: string,
  detector: PromptDetector,
  tracker?: Osc133Tracker
): Promise<number | null> {
  const probe = `${buildExitProbe(detector.flavor)}${lineEnding()}`;
  const waiter = tracker?.integrationActive
    ? createMarkerCommandWaiter(port, sessionId, EXIT_PROBE_TIMEOUT_MS)
    : createCommandWaiter(port, sessionId, detector, EXIT_PROBE_TIMEOUT_MS, shellPromptIdleMs());
  if (!port.write(sessionId, probe)) {
    waiter.cancel();
    await waiter.promise.catch(() => undefined);
    return null;
  }
  try {
    const result = await waiter.promise;
    const slice = typeof result === "string" ? result : result.slice;
    return parseExitProbeValue(slice);
  } catch {
    await recoverShellToPrompt(port, sessionId, detector, tracker).catch(() => undefined);
    return null;
  }
}

/**
 * One-off boot wait for a freshly opened terminal tab (background jobs etc.):
 * resolves on the first OSC 133 prompt marker, with the legacy stable-prompt
 * detector racing as fallback for shells without integration.
 */
export async function waitForShellBoot(
  port: PtyManagerPort,
  sessionId: string,
  timeoutMs = shellBootTimeoutMs()
): Promise<void> {
  const tracker = new Osc133Tracker();
  const backlog = port.readTail(sessionId, MAX_CAPTURE);
  if (backlog) tracker.feed(backlog);
  const unsub = port.onData(sessionId, (chunk) => {
    tracker.feed(chunk);
  });
  const ac = new AbortController();
  const markerBoot = waitForMarkerPrompt(port, sessionId, tracker, timeoutMs, ac.signal);
  const legacyBoot = waitForStablePrompt(port, sessionId, {
    timeoutMs,
    stableMs: shellPromptStableMs(),
    minBytes: SHELL_MIN_BOOT_BYTES,
    requireMinBytes: true,
    signal: ac.signal,
  });
  markerBoot.catch(() => undefined);
  legacyBoot.catch(() => undefined);
  try {
    await Promise.any([markerBoot, legacyBoot]);
  } catch (err) {
    const first = err instanceof AggregateError ? err.errors[0] : err;
    throw first instanceof Error ? first : new Error(String(first));
  } finally {
    ac.abort();
    unsub();
  }
}

export class AgentShellSession {
  private handle: SessionHandle | null = null;
  private booted = false;
  private bootPromise: Promise<void> | null = null;
  private detector = new PromptDetector();
  /** Session-lifetime OSC 133 state, fed by a persistent onData subscription. */
  private tracker = new Osc133Tracker();
  private trackerUnsub: (() => void) | null = null;

  constructor(private readonly chatId: string) {}

  warmup(): Promise<void> {
    return enqueueAgentShell(this.chatId, () => this.attach());
  }

  exec(opts: AgentShellExecOptions): Promise<ToolResult> {
    return enqueueAgentShell(this.chatId, () => this.execInner(opts));
  }

  private get markerMode(): boolean {
    return this.tracker.integrationActive;
  }

  private async execInner(opts: AgentShellExecOptions): Promise<ToolResult> {
    try {
      await this.attach();
      await this.waitIdle();
    } catch (err) {
      return {
        ok: false,
        error: `Agent terminal is not ready.\n${errorMessage(err)}`,
      };
    }

    const port = getPtyShellPort();
    if (!port || !this.handle) {
      return { ok: false, error: "PTY shell port is not available." };
    }

    await ensureChatTerminal({
      chatId: this.chatId,
      label: "Agent shell",
      source: "agent",
      forceNew: false,
      focus: true,
    });

    return this.markerMode
      ? this.execWithMarkers(port, opts)
      : this.execLegacy(port, opts);
  }

  /** Marker path: type the command, wait for the shell's completion marker. */
  private async execWithMarkers(
    port: PtyManagerPort,
    opts: AgentShellExecOptions
  ): Promise<ToolResult> {
    const sessionId = this.handle!.sessionId;
    const input = buildHumanShellInput(opts.command, opts.cwd);
    const typedLine = buildShellCommandLine(opts.command, opts.cwd);
    const waiter = createMarkerCommandWaiter(port, sessionId, opts.timeoutMs);

    if (!port.write(sessionId, input)) {
      waiter.cancel();
      await waiter.promise.catch(() => undefined);
      return { ok: false, error: "Failed to write to agent terminal stdin." };
    }

    try {
      const { slice, exitCode: markerCode } = await waiter.promise;
      const plain = normalizeNewlines(stripAnsi(slice));
      const output = stripEchoedCommand(plain, typedLine);
      const exitCode =
        markerCode ?? (await probeExitCode(port, sessionId, this.detector, this.tracker)) ?? 0;
      return this.formatResult(output, exitCode, opts.cappedNote);
    } catch (err) {
      await recoverShellToPrompt(port, sessionId, this.detector, this.tracker).catch(
        () => undefined
      );
      return { ok: false, error: errorMessage(err) };
    }
  }

  /** Legacy path: prompt-detector heuristics (no shell integration available). */
  private async execLegacy(
    port: PtyManagerPort,
    opts: AgentShellExecOptions
  ): Promise<ToolResult> {
    const sessionId = this.handle!.sessionId;
    const input = buildHumanShellInput(opts.command, opts.cwd);
    const waiter = createCommandWaiter(
      port,
      sessionId,
      this.detector,
      opts.timeoutMs,
      shellPromptIdleMs()
    );

    if (!port.write(sessionId, input)) {
      waiter.cancel();
      await waiter.promise.catch(() => undefined);
      return { ok: false, error: "Failed to write to agent terminal stdin." };
    }

    try {
      const raw = await waiter.promise;
      // Extract with the pre-command prompt (the echoed input line used it),
      // THEN learn the new prompt (cwd may have changed) before probing.
      const output = extractCommandOutput(raw, this.detector);
      this.detector.learnFrom(raw);
      const exitCode = (await probeExitCode(port, sessionId, this.detector)) ?? 0;
      return this.formatResult(output, exitCode, opts.cappedNote);
    } catch (err) {
      await recoverShellToPrompt(port, sessionId, this.detector).catch(() => undefined);
      return { ok: false, error: errorMessage(err) };
    }
  }

  private formatResult(output: string, exitCode: number, cappedNote?: string): ToolResult {
    const body = capShellToolOutput(output.trimEnd() || "(no output)");
    const full = (cappedNote ?? "") + body;
    if (exitCode !== 0) {
      if (body.length >= 120) {
        return {
          ok: true,
          output: `[exit ${exitCode} — see Terminal panel for full scrollback]\n${full}`,
        };
      }
      return { ok: false, error: `Exit code ${exitCode}.\n${full}` };
    }
    return { ok: true, output: full };
  }

  private startTrackerFeed(port: PtyManagerPort, sessionId: string): void {
    this.trackerUnsub?.();
    this.tracker = new Osc133Tracker();
    // Seed with whatever already arrived (reused sessions have a backlog).
    const backlog = port.readTail(sessionId, MAX_CAPTURE);
    if (backlog) this.tracker.feed(backlog);
    this.trackerUnsub = port.onData(sessionId, (chunk) => {
      this.tracker.feed(chunk);
    });
  }

  private async attach(): Promise<void> {
    const port = getPtyShellPort();
    if (!port) throw new Error("PTY shell port is not available.");

    if (this.handle && port.isAlive(this.handle.sessionId)) {
      if (!this.booted) await this.ensureBooted(port);
      return;
    }

    // New (or replacement) session — previous learned prompt no longer applies.
    this.handle = null;
    this.booted = false;
    this.detector = new PromptDetector();
    this.trackerUnsub?.();
    this.trackerUnsub = null;

    const viaEnsure = await ensureChatTerminal({
      chatId: this.chatId,
      label: "Agent shell",
      source: "agent",
      forceNew: false,
      focus: false,
    });
    const opened =
      viaEnsure ??
      (await port.ensure({
        chatId: this.chatId,
        label: "Agent shell",
        source: "agent",
        forceNew: false,
        focus: false,
      }));

    if (!opened) throw new Error("Failed to open agent terminal session.");
    this.handle = opened;
    this.startTrackerFeed(port, opened.sessionId);
    await this.ensureBooted(port);
  }

  private async ensureBooted(port: PtyManagerPort): Promise<void> {
    if (!this.handle || this.booted) return;
    if (this.bootPromise) return this.bootPromise;

    const sessionId = this.handle.sessionId;
    if (!this.trackerUnsub) this.startTrackerFeed(port, sessionId);

    // Marker-first boot: the injected integration emits a B marker with the
    // first prompt. The legacy stable-prompt detector races as fallback for
    // shells without integration. Whichever resolves first wins; the loser
    // is aborted so no timers linger.
    const ac = new AbortController();
    const markerBoot = waitForMarkerPrompt(
      port,
      sessionId,
      this.tracker,
      shellBootTimeoutMs(),
      ac.signal
    );
    const legacyBoot = waitForStablePrompt(port, sessionId, {
      timeoutMs: shellBootTimeoutMs(),
      stableMs: shellPromptStableMs(),
      minBytes: SHELL_MIN_BOOT_BYTES,
      requireMinBytes: true,
      detector: this.detector,
      signal: ac.signal,
    });
    markerBoot.catch(() => undefined);
    legacyBoot.catch(() => undefined);

    this.bootPromise = Promise.any([markerBoot, legacyBoot])
      .catch((err: unknown) => {
        const first = err instanceof AggregateError ? err.errors[0] : err;
        throw first instanceof Error ? first : new Error(String(first));
      })
      .then(() => {
        if (port.isAlive(sessionId)) {
          this.booted = true;
          this.detector.learnFrom(port.readTail(sessionId, PROMPT_CHECK_TAIL_CHARS));
        }
      })
      .finally(() => {
        this.bootPromise = null;
        ac.abort();
      });

    return this.bootPromise;
  }

  private async waitIdle(): Promise<void> {
    const port = getPtyShellPort();
    if (!port || !this.handle) throw new Error("No agent shell session.");
    const sessionId = this.handle.sessionId;

    if (this.markerMode) {
      try {
        await waitForMarkerPrompt(port, sessionId, this.tracker, SHELL_READY_TIMEOUT_MS);
      } catch {
        // A previous command may have left a pager or stuck process — Ctrl+C
        // once and retry briefly instead of failing every run_shell.
        await recoverShellToPrompt(port, sessionId, this.detector, this.tracker).catch(
          () => undefined
        );
        await waitForMarkerPrompt(port, sessionId, this.tracker, 5_000);
      }
      return;
    }

    const opts: StablePromptOptions = {
      timeoutMs: SHELL_READY_TIMEOUT_MS,
      stableMs: Math.min(shellPromptStableMs(), IDLE_STABLE_MS),
      requireMinBytes: false,
      detector: this.detector,
    };
    try {
      await waitForStablePrompt(port, sessionId, opts);
    } catch {
      await recoverShellToPrompt(port, sessionId, this.detector).catch(() => undefined);
      await waitForStablePrompt(port, sessionId, { ...opts, timeoutMs: 5_000 });
    }
  }
}
