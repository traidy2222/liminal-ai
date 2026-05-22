/**
 * World context differential refresh — mid-session volatile section updates.
 *
 * Re-gathers only the volatile sections (git, ports, resources, env) every
 * AGENT_WORLD_REFRESH_EVERY turns (default: 8). Produces a compact [WORLD DELTA]
 * system message with only what changed vs. the session-start snapshot.
 *
 * Static sections (project, tools, code-style) are gathered once and never refreshed.
 */

import type { Message } from "./types.js";
import { effectiveHarnessEnvRaw } from "./harness_effective_env.js";
import {
  gatherGitContext,
  scanActiveDevPorts,
  type GitContext,
  type PortContext,
} from "./platform_context.js";
import os from "node:os";

export interface VolatileSnapshot {
  git: GitContext | null;
  ports: PortContext | null;
  freeRamGB: number;
  envKeys: string[];
  capturedAt: number;
}

const WATCHED_ENV_VOLATILE = [
  "NODE_ENV", "PORT", "HOST", "DEBUG",
  "DATABASE_URL", "REDIS_URL", "CI",
];

function captureEnvKeys(): string[] {
  return WATCHED_ENV_VOLATILE.filter((k) => process.env[k] !== undefined);
}

function resolveRefreshEvery(): number {
  const raw = effectiveHarnessEnvRaw("AGENT_WORLD_REFRESH_EVERY")?.trim();
  if (!raw) return 8;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? Math.max(2, Math.min(50, n)) : 8;
}

/** Gather a fresh volatile snapshot. Degrades gracefully on timeout. */
export async function gatherVolatileSnapshot(workspaceRoot: string): Promise<VolatileSnapshot> {
  const [git, ports] = await Promise.all([
    withTimeout(gatherGitContext(workspaceRoot), 800),
    withTimeout(scanActiveDevPorts([3000,3001,3002,4000,5000,5173,8000,8080,9000]), 600),
  ]);

  return {
    git: git ?? null,
    ports: ports ?? null,
    freeRamGB: os.freemem() / 1024 ** 3,
    envKeys: captureEnvKeys(),
    capturedAt: Date.now(),
  };
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race<T | null>([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

function fmtGB(gb: number): string {
  return gb >= 10 ? `${Math.round(gb)} GB` : `${gb.toFixed(1)} GB`;
}

/** Diff two snapshots and produce a compact delta string. Returns null if nothing changed. */
export function diffVolatileSnapshots(
  prev: VolatileSnapshot,
  next: VolatileSnapshot
): string | null {
  const lines: string[] = [];

  // Git changes
  if (prev.git && next.git) {
    if (prev.git.branch !== next.git.branch) {
      lines.push(`git_branch: ${prev.git.branch} → ${next.git.branch}`);
    }
    if (prev.git.commitHash !== next.git.commitHash) {
      lines.push(`git_commit: ${next.git.commitHash.slice(0, 8)} "${next.git.commitMessage}"`);
    }
    if (prev.git.isDirty !== next.git.isDirty) {
      lines.push(`git_status: ${next.git.isDirty ? "DIRTY (uncommitted changes)" : "clean"}`);
    }
  } else if (!prev.git && next.git) {
    lines.push(`git: ${next.git.branch} @ ${next.git.commitHash.slice(0, 8)}`);
  }

  // Port changes
  if (prev.ports && next.ports) {
    const prevBusy = new Set(prev.ports.busy);
    const nextBusy = new Set(next.ports.busy);
    const newlyBusy = next.ports.busy.filter((p) => !prevBusy.has(p));
    const newlyFree = prev.ports.busy.filter((p) => !nextBusy.has(p));
    if (newlyBusy.length > 0) lines.push(`ports_now_busy: ${newlyBusy.map((p) => `:${p}`).join(" ")}`);
    if (newlyFree.length > 0) lines.push(`ports_now_free: ${newlyFree.map((p) => `:${p}`).join(" ")}`);
  }

  // RAM drift (only report if >1 GB change)
  const ramDelta = next.freeRamGB - prev.freeRamGB;
  if (Math.abs(ramDelta) >= 1) {
    lines.push(`free_ram: ${fmtGB(next.freeRamGB)} (${ramDelta > 0 ? "+" : ""}${fmtGB(ramDelta)})`);
  }

  // Env changes
  const prevEnvSet = new Set(prev.envKeys);
  const nextEnvSet = new Set(next.envKeys);
  const newEnv = next.envKeys.filter((k) => !prevEnvSet.has(k));
  const removedEnv = prev.envKeys.filter((k) => !nextEnvSet.has(k));
  if (newEnv.length > 0) lines.push(`env_set: ${newEnv.join(", ")}`);
  if (removedEnv.length > 0) lines.push(`env_unset: ${removedEnv.join(", ")}`);

  if (lines.length === 0) return null;
  return lines.join("\n");
}

/**
 * WorldContextRefresher tracks the turn counter and emits delta messages.
 * One instance lives on the root AgentHarness.
 */
export class WorldContextRefresher {
  private turnCount = 0;
  private snapshot: VolatileSnapshot | null = null;
  private readonly refreshEvery: number;
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.refreshEvery = resolveRefreshEvery();
  }

  /** Call once at session start to capture baseline. */
  async init(): Promise<void> {
    this.snapshot = await gatherVolatileSnapshot(this.workspaceRoot);
  }

  /**
   * Called before each send(). Returns a [WORLD DELTA] system message when
   * changes are detected on the refresh cycle, otherwise null.
   */
  async tick(): Promise<Message | null> {
    this.turnCount++;
    if (this.turnCount % this.refreshEvery !== 0) return null;
    if (!this.snapshot) {
      this.snapshot = await gatherVolatileSnapshot(this.workspaceRoot);
      return null;
    }

    const next = await gatherVolatileSnapshot(this.workspaceRoot);
    const delta = diffVolatileSnapshots(this.snapshot, next);
    this.snapshot = next;

    if (!delta) return null;

    return {
      role: "system",
      content:
        `[WORLD DELTA — turn ${this.turnCount}, refreshed volatile context]\n` +
        delta +
        `\nUse this over any stale world context from session start.`,
    };
  }
}
