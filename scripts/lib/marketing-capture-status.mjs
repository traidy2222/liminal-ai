/**
 * Marketing capture progress + completion signals for humans and automation.
 *
 * - Status file: assets/marketing/.capture-status.json
 * - Sentinel stdout: MARKETING_CAPTURE_STATUS=<state> key=value ...
 * - Optional desktop toast when MARKETING_CAPTURE_NOTIFY=1
 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

export const STATUS_BASENAME = ".capture-status.json";
export const DONE_MARKER_BASENAME = ".capture-done";

/**
 * @param {string} repoRoot
 */
export function statusFilePath(repoRoot) {
  return path.join(repoRoot, "assets", "marketing", STATUS_BASENAME);
}

/**
 * @param {string} repoRoot
 */
export function doneMarkerPath(repoRoot) {
  return path.join(repoRoot, "assets", "marketing", DONE_MARKER_BASENAME);
}

/**
 * @param {string} state
 * @param {Record<string, string | number | boolean | undefined | null>} [fields]
 */
export function emitStatusLine(state, fields = {}) {
  const parts = [`MARKETING_CAPTURE_STATUS=${state}`];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue;
    const s = String(v).replace(/\s+/g, " ");
    parts.push(`${k}=${s}`);
  }
  const line = parts.join(" ");
  console.log(line);
  return line;
}

/**
 * @param {string} repoRoot
 */
export async function readCaptureStatus(repoRoot) {
  try {
    const text = await fs.readFile(statusFilePath(repoRoot), "utf8");
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** @param {number | undefined | null} pid */
export function isCapturePidAlive(pid) {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Terminal status from a prior run — not an in-flight capture.
 * @param {Record<string, unknown> | null | undefined} status
 */
export function isStaleTerminalStatus(status) {
  if (!status) return false;
  if (status.status !== "completed" && status.status !== "failed") return false;
  return !isCapturePidAlive(Number(status.pid));
}

function notifyDesktop(title, message) {
  if (process.env.MARKETING_CAPTURE_NOTIFY !== "1") return;
  if (process.platform !== "win32") {
    process.stdout.write("\x07");
    return;
  }
  const ps = `
$null = [System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms')
$null = [System.Reflection.Assembly]::LoadWithPartialName('System.Drawing')
$n = New-Object System.Windows.Forms.NotifyIcon
$n.Icon = [System.Drawing.SystemIcons]::Information
$n.BalloonTipTitle = ${JSON.stringify(title)}
$n.BalloonTipText = ${JSON.stringify(message)}
$n.Visible = $true
$n.ShowBalloonTip(10000)
Start-Sleep -Seconds 11
$n.Dispose()
`;
  spawn("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], {
    detached: true,
    stdio: "ignore",
  }).unref();
}

export class MarketingCaptureStatus {
  /**
   * @param {{
   *   repoRoot: string;
   *   channel: string;
   *   promptIds?: string[];
   *   phase?: string;
   * }} opts
   */
  constructor(opts) {
    this.repoRoot = opts.repoRoot;
    this.channel = opts.channel;
    this.phase = opts.phase ?? opts.channel;
    this.path = statusFilePath(opts.repoRoot);
    /** @type {Array<{ id: string; status: string; startedAt?: string; finishedAt?: string; error?: string; tools?: string[] }>} */
    this.prompts = (opts.promptIds ?? []).map((id) => ({ id, status: "pending" }));
    this.startedAt = new Date().toISOString();
    this.pid = process.pid;
  }

  async #write(partial) {
    const payload = {
      status: "running",
      channel: this.channel,
      phase: this.phase,
      pid: this.pid,
      startedAt: this.startedAt,
      updatedAt: new Date().toISOString(),
      prompts: this.prompts,
      ...partial,
    };
    await fs.mkdir(path.dirname(this.path), { recursive: true });
    await fs.writeFile(this.path, JSON.stringify(payload, null, 2) + "\n", "utf8");
    return payload;
  }

  async start() {
    await fs.rm(doneMarkerPath(this.repoRoot), { force: true }).catch(() => {});
    this.runId = `${this.startedAt}-${this.pid}`;
    await this.#write({
      status: "running",
      runId: this.runId,
      finishedAt: null,
      exitCode: null,
      summary: "Starting…",
    });
    emitStatusLine("running", {
      phase: this.phase,
      channel: this.channel,
      prompts: this.prompts.length,
      pid: this.pid,
    });
  }

  /**
   * @param {string} id
   */
  async promptStart(id) {
    let row = this.prompts.find((p) => p.id === id);
    const startedAt = new Date().toISOString();
    if (row) {
      row.status = "running";
      row.startedAt = startedAt;
      delete row.error;
      delete row.frames;
      delete row.detail;
    } else {
      row = { id, status: "running", startedAt };
      this.prompts.push(row);
    }
    await this.#write({
      currentPrompt: id,
      promptStartedAt: startedAt,
      frameProgress: 0,
      promptElapsedSec: 0,
      summary: `${this.#counts().done}/${this.prompts.length} prompts`,
    });
    emitStatusLine("running", { phase: this.phase, prompt: id });
  }

  /**
   * @param {string} id
   * @param {{ frames?: number; detail?: string }} progress
   */
  async promptProgress(id, progress = {}) {
    const row = this.prompts.find((p) => p.id === id);
    if (row && progress.frames != null) row.frames = progress.frames;
    if (row && progress.detail) row.detail = progress.detail;
    const elapsed =
      row?.startedAt != null
        ? Math.max(0, Math.round((Date.now() - Date.parse(row.startedAt)) / 1000))
        : 0;
    const detail = progress.detail ?? (progress.frames != null ? `${progress.frames} frames` : "");
    await this.#write({
      currentPrompt: id,
      frameProgress: progress.frames ?? undefined,
      promptElapsedSec: elapsed,
      summary: `${this.#counts().done}/${this.prompts.length} prompts · ${id} ${elapsed}s${detail ? ` · ${detail}` : ""}`,
    });
  }

  /**
   * @param {string} id
   * @param {{ ok: boolean; error?: string; tools?: string[] }} result
   */
  async promptEnd(id, result) {
    const row = this.prompts.find((p) => p.id === id);
    if (row) {
      row.status = result.ok ? "completed" : "failed";
      row.finishedAt = new Date().toISOString();
      if (result.error) row.error = result.error;
      if (result.tools?.length) row.tools = result.tools;
    }
    const counts = this.#counts();
    await this.#write({
      currentPrompt: null,
      summary: `${counts.done}/${this.prompts.length} prompts (${counts.ok} ok, ${counts.failed} failed)`,
    });
    emitStatusLine(result.ok ? "prompt_ok" : "prompt_failed", {
      phase: this.phase,
      prompt: id,
      progress: `${counts.done}/${this.prompts.length}`,
    });
  }

  #counts() {
    const done = this.prompts.filter((p) => p.status === "completed" || p.status === "failed").length;
    const ok = this.prompts.filter((p) => p.status === "completed").length;
    const failed = this.prompts.filter((p) => p.status === "failed").length;
    return { done, ok, failed };
  }

  /**
   * @param {{
   *   ok: boolean;
   *   exitCode: number;
   *   message?: string;
   *   results?: object[];
   * }} outcome
   */
  async finish(outcome) {
    const counts = this.#counts();
    const finishedAt = new Date().toISOString();
    const state = outcome.ok ? "completed" : "failed";
    const summary =
      outcome.message ??
      `${counts.ok}/${this.prompts.length} captures succeeded` +
        (counts.failed ? `, ${counts.failed} failed` : "");

    await this.#write({
      status: state,
      finishedAt,
      exitCode: outcome.exitCode,
      summary,
      currentPrompt: null,
      results: outcome.results ?? undefined,
    });

    if (outcome.ok) {
      await fs.writeFile(
        doneMarkerPath(this.repoRoot),
        `${finishedAt}\t${this.channel}\t${summary}\n`,
        "utf8"
      );
    } else {
      await fs.rm(doneMarkerPath(this.repoRoot), { force: true }).catch(() => {});
    }

    emitStatusLine(state, {
      phase: this.phase,
      channel: this.channel,
      exit: outcome.exitCode,
      ok: counts.ok,
      failed: counts.failed,
      summary,
    });

    notifyDesktop(
      outcome.ok ? "Marketing capture complete" : "Marketing capture failed",
      summary
    );
    process.stdout.write("\x07");
  }

  /**
   * @param {unknown} err
   */
  async fail(err) {
    const message = err instanceof Error ? err.message : String(err);
    await this.finish({ ok: false, exitCode: 1, message });
  }

  /**
   * @param {string} phase
   */
  async setPhase(phase) {
    this.phase = phase;
    await this.#write({ phase });
    emitStatusLine("running", { phase });
  }
}
