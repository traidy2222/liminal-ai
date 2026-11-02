/**
 * Plan-scoped compensation ledger — append-only log of undo actions that accumulate
 * as plan steps execute. On plan failure, plays back in reverse order to clean up
 * side-effects from completed steps.
 *
 * Phase 1 scope: delete_file, git_reset_to_checkpoint, remove_artifact, restore_file_content.
 * Phase 2 will extend this into a full saga / two-phase-commit pattern.
 */

import { unlink, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { effectiveHarnessEnvRaw } from "./harness_effective_env.js";

const execFileAsync = promisify(execFile);

export type CompensationAction =
  | { kind: "delete_file"; path: string }
  | { kind: "git_reset"; checkpointRef: string }
  | { kind: "remove_artifact"; artifactPath: string }
  | { kind: "restore_file_content"; path: string; originalContent: string };

export interface LedgerEntry {
  planId: string;
  stepIndex: number;
  action: CompensationAction;
  recordedAt: number;
}

export interface CompensationResult {
  action: CompensationAction;
  ok: boolean;
  error?: string;
}

export interface CompensationPlaybackOptions {
  /** Workspace root for relative paths and git commands. */
  workspaceRoot?: string;
  /** When set, only replay entries recorded at this ReAct round index. */
  onlyStepIndex?: number;
}

function isEnabled(): boolean {
  return effectiveHarnessEnvRaw("AGENT_COMPENSATION_ENABLED") !== "0";
}

function maxActions(): number {
  const n = parseInt(effectiveHarnessEnvRaw("AGENT_COMPENSATION_MAX_ACTIONS") ?? "32", 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 256) : 32;
}

function resolvePath(filePath: string, workspaceRoot?: string): string {
  if (path.isAbsolute(filePath)) return filePath;
  return path.resolve(workspaceRoot ?? process.cwd(), filePath);
}

export class CompensationLedger {
  private entries: LedgerEntry[] = [];

  record(planId: string, stepIndex: number, action: CompensationAction): void {
    if (!isEnabled()) return;
    const planEntries = this.entries.filter((e) => e.planId === planId);
    if (planEntries.length >= maxActions()) {
      throw new Error(
        `CompensationLedger: plan "${planId}" exceeded max compensation actions (${maxActions()}). ` +
          "Either increase AGENT_COMPENSATION_MAX_ACTIONS or break the plan into smaller units."
      );
    }
    this.entries.push({ planId, stepIndex, action, recordedAt: Date.now() });
  }

  /** Replay compensation actions for a plan in reverse step order. */
  async playback(
    planId: string,
    opts?: CompensationPlaybackOptions
  ): Promise<CompensationResult[]> {
    let relevant = this.entries
      .filter((e) => e.planId === planId)
      .sort((a, b) => b.stepIndex - a.stepIndex || b.recordedAt - a.recordedAt);
    if (opts?.onlyStepIndex !== undefined) {
      relevant = relevant.filter((e) => e.stepIndex === opts.onlyStepIndex);
    }

    const results: CompensationResult[] = [];
    for (const entry of relevant) {
      const result = await executeCompensationAction(entry.action, opts);
      results.push(result);
    }
    const undoneIds = new Set(relevant.map((e) => e));
    this.entries = this.entries.filter((e) => !undoneIds.has(e));
    return results;
  }

  /**
   * Drop pending undo actions for a path after a successful write/edit — the
   * artifact should survive later failures in other rounds.
   */
  commitPath(planId: string, filePath: string): void {
    const norm = filePath.trim().replace(/\\/g, "/");
    if (!norm) return;
    this.entries = this.entries.filter((e) => {
      if (e.planId !== planId) return true;
      const a = e.action;
      if (a.kind === "delete_file" || a.kind === "restore_file_content") {
        return a.path.trim().replace(/\\/g, "/") !== norm;
      }
      return true;
    });
  }

  clear(planId: string): void {
    this.entries = this.entries.filter((e) => e.planId !== planId);
  }

  clearAll(): void {
    this.entries = [];
  }

  snapshot(): LedgerEntry[] {
    return [...this.entries];
  }

  entriesForPlan(planId: string): LedgerEntry[] {
    return this.entries.filter((e) => e.planId === planId);
  }
}

async function executeCompensationAction(
  action: CompensationAction,
  opts?: CompensationPlaybackOptions
): Promise<CompensationResult> {
  const root = opts?.workspaceRoot;
  try {
    if (action.kind === "delete_file") {
      await unlink(resolvePath(action.path, root));
      return { action, ok: true };
    }
    if (action.kind === "git_reset") {
      const cwd = root ?? process.cwd();
      await execFileAsync("git", ["reset", "--hard", action.checkpointRef], { cwd });
      return { action, ok: true };
    }
    if (action.kind === "remove_artifact") {
      await unlink(resolvePath(action.artifactPath, root));
      return { action, ok: true };
    }
    if (action.kind === "restore_file_content") {
      const p = resolvePath(action.path, root);
      await writeFile(p, action.originalContent, "utf8");
      return { action, ok: true };
    }
    return { action, ok: false, error: "unknown action kind" };
  } catch (err) {
    return {
      action,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Snapshot a file's content before a mutating tool call so it can be restored
 * on plan failure. Returns null if the file does not exist (new file — use delete_file).
 */
export async function snapshotFileForCompensation(
  filePath: string,
  workspaceRoot?: string
): Promise<string | null> {
  const resolved = resolvePath(filePath, workspaceRoot);
  try {
    return await readFile(resolved, "utf8");
  } catch {
    return null;
  }
}

/**
 * Map a tool name + args to a compensation action, or null if no compensation needed.
 * Called after each successful tool execution in a planned sequence.
 */
export function inferCompensationAction(
  toolName: string,
  args: Record<string, unknown>
): CompensationAction | null {
  if (toolName === "write_file") {
    const mode = args["mode"];
    if (mode === "overwrite" || mode === "append") {
      // File pre-existed — undo is restore-content, not delete. Caller must
      // snapshot via snapshotFileForCompensation() before dispatch (like edit_file).
      return null;
    }
    // mode=create (default): undo is deleting the newly created file.
    const filePath = (args["path"] as string | undefined)?.trim();
    if (filePath) return { kind: "delete_file", path: filePath };
  }
  if (toolName === "edit_file") {
    // Caller must snapshot content via snapshotFileForCompensation() before dispatch
    // and record a restore_file_content action manually — we can't do it here async.
    return null;
  }
  if (toolName === "git_checkpoint") {
    const ref = (args["ref"] as string | undefined)?.trim() || (args["checkpoint_ref"] as string | undefined)?.trim();
    if (ref) return { kind: "git_reset", checkpointRef: ref };
  }
  if (toolName === "mkdir_p") {
    const dirPath = (args["path"] as string | undefined)?.trim();
    if (dirPath) return { kind: "delete_file", path: dirPath };
  }
  return null;
}

export function formatCompensationReport(results: CompensationResult[]): string {
  if (results.length === 0) return "(no compensation actions)";
  const lines = results.map((r) => {
    let desc: string;
    if (r.action.kind === "delete_file") desc = `delete ${r.action.path}`;
    else if (r.action.kind === "git_reset") desc = `git reset --hard ${r.action.checkpointRef}`;
    else if (r.action.kind === "remove_artifact") desc = `remove artifact ${r.action.artifactPath}`;
    else desc = `restore ${r.action.path} (${r.action.originalContent.length} chars)`;
    return r.ok ? `  ✓ ${desc}` : `  ✗ ${desc} — ${r.error ?? "unknown error"}`;
  });
  return `[COMPENSATION APPLIED: ${results.length} action(s)]\n${lines.join("\n")}`;
}
