/**
 * Causal trajectory memory writer.
 *
 * At the end of successful sends where ≥3 tools succeeded and at least one
 * hypothesis was active, writes a "trajectory:" memory entry that records:
 *   - The triggering user message
 *   - Hypotheses considered
 *   - Tools used and their success/failure
 *   - Causal summary of what changed and why
 *
 * memory_rank.ts already gives trajectory: the highest type boost (0.22),
 * making these the most valuable recall targets across sessions.
 *
 * Gate: AGENT_TRAJECTORY_WRITE=1 (default off to avoid noise on short turns)
 */

import { writeFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
// resolveWorkspaceRoot no longer used here — notes path now resolves via
// global_storage.js (lazy-imported inside loadNotes/saveNotes to avoid a
// circular import).
import { effectiveHarnessEnvRaw } from "./harness_effective_env.js";
import type { EpistemicState } from "./types.js";

export interface TrajectoryEntry {
  version: 1;
  createdAt: string;
  trigger: string;
  hypothesesConsidered: Array<{
    claim: string;
    confidence: "low" | "med" | "high";
    outcome: "confirmed" | "rejected" | "pending";
  }>;
  toolsUsed: Array<{ name: string; ok: boolean }>;
  filesModified: string[];
  causalSummary: string;
  intentClass?: string;
  roundCount: number;
}

type NotesStore = Record<string, { value: string; updatedAt: string; createdAt: string }>;

const MAX_TRAJECTORIES = 200;

function isEnabled(): boolean {
  return effectiveHarnessEnvRaw("AGENT_TRAJECTORY_WRITE") === "1";
}

async function loadNotes(): Promise<NotesStore> {
  try {
    const { notesPaths, pickReadPath } = await import("./global_storage.js");
    const p = await pickReadPath(notesPaths());
    const raw = await readFile(p, "utf8");
    return JSON.parse(raw) as NotesStore;
  } catch {
    return {};
  }
}

async function saveNotes(notes: NotesStore): Promise<void> {
  const { notesPaths, pickWritePath, ensureGlobalStorageRoot } = await import(
    "./global_storage.js"
  );
  await ensureGlobalStorageRoot();
  const p = await pickWritePath(notesPaths());
  // Ensure parent exists for safety (the legacy fallback path may not exist if
  // the workspace dir is new).
  const dir = join(p, "..");
  await mkdir(dir, { recursive: true });
  await writeFile(p, JSON.stringify(notes, null, 2), "utf8");
}

function buildCausalSummary(
  trigger: string,
  toolsUsed: TrajectoryEntry["toolsUsed"],
  filesModified: string[],
  hypotheses: TrajectoryEntry["hypothesesConsidered"]
): string {
  const successTools = toolsUsed.filter((t) => t.ok).map((t) => t.name);
  const failTools = toolsUsed.filter((t) => !t.ok).map((t) => t.name);
  const parts: string[] = [];

  const triggerSnippet = trigger.slice(0, 120).replace(/\n/g, " ");
  parts.push(`Task: ${triggerSnippet}${trigger.length > 120 ? "…" : ""}`);

  if (successTools.length > 0) {
    const unique = [...new Set(successTools)];
    parts.push(`Tools succeeded: ${unique.slice(0, 8).join(", ")}`);
  }
  if (failTools.length > 0) {
    const unique = [...new Set(failTools)];
    parts.push(`Tools failed: ${unique.slice(0, 4).join(", ")}`);
  }
  if (filesModified.length > 0) {
    parts.push(`Modified: ${filesModified.slice(0, 6).join(", ")}`);
  }

  const confirmedHyp = hypotheses.filter((h) => h.outcome === "confirmed");
  const rejectedHyp = hypotheses.filter((h) => h.outcome === "rejected");
  if (confirmedHyp.length > 0) {
    parts.push(`Confirmed: ${confirmedHyp.map((h) => h.claim.slice(0, 60)).join("; ")}`);
  }
  if (rejectedHyp.length > 0) {
    parts.push(`Rejected: ${rejectedHyp.map((h) => h.claim.slice(0, 60)).join("; ")}`);
  }

  return parts.join(" | ");
}

function pruneOldTrajectories(notes: NotesStore): void {
  const trajectoryKeys = Object.keys(notes).filter((k) => k.startsWith("trajectory:"));
  if (trajectoryKeys.length <= MAX_TRAJECTORIES) return;

  // Sort by updatedAt ascending (oldest first), prune oldest
  trajectoryKeys.sort((a, b) => {
    const aT = notes[a]?.updatedAt ?? "";
    const bT = notes[b]?.updatedAt ?? "";
    return aT.localeCompare(bT);
  });

  const toRemove = trajectoryKeys.slice(0, trajectoryKeys.length - MAX_TRAJECTORIES);
  for (const k of toRemove) {
    delete notes[k];
  }
}

export interface TrajectoryWriteInput {
  trigger: string;
  epistemicState: EpistemicState | null;
  toolsUsed: Array<{ name: string; ok: boolean }>;
  roundCount: number;
  intentClass?: string;
}

/**
 * Write a trajectory: memory entry for this send if conditions are met:
 * - AGENT_TRAJECTORY_WRITE=1
 * - ≥3 tools succeeded
 * - At least one hypothesis was active OR ≥2 files were modified
 */
export async function maybeWriteTrajectory(input: TrajectoryWriteInput): Promise<boolean> {
  if (!isEnabled()) return false;

  const successCount = input.toolsUsed.filter((t) => t.ok).length;
  if (successCount < 3) return false;

  const hasHypotheses = (input.epistemicState?.hypotheses?.length ?? 0) > 0;
  const hasModifiedFiles = (input.epistemicState?.filesModified?.length ?? 0) >= 2;
  if (!hasHypotheses && !hasModifiedFiles) return false;

  const now = new Date().toISOString();
  const hypothesesConsidered: TrajectoryEntry["hypothesesConsidered"] =
    (input.epistemicState?.hypotheses ?? []).slice(0, 8).map((h) => ({
      claim: h.claim.slice(0, 200),
      confidence: h.confidence,
      outcome:
        h.status === "confirmed"
          ? "confirmed"
          : h.status === "rejected"
          ? "rejected"
          : "pending",
    }));

  const filesModified = (input.epistemicState?.filesModified ?? []).slice(0, 12);

  const causalSummary = buildCausalSummary(
    input.trigger,
    input.toolsUsed,
    filesModified,
    hypothesesConsidered
  );

  const entry: TrajectoryEntry = {
    version: 1,
    createdAt: now,
    trigger: input.trigger.slice(0, 400),
    hypothesesConsidered,
    toolsUsed: input.toolsUsed.slice(0, 40),
    filesModified,
    causalSummary,
    intentClass: input.intentClass,
    roundCount: input.roundCount,
  };

  const key = `trajectory:${createHash("sha256")
    .update(input.trigger.slice(0, 200) + now)
    .digest("hex")
    .slice(0, 16)}`;

  try {
    const notes = await loadNotes();
    pruneOldTrajectories(notes);
    notes[key] = {
      value: JSON.stringify(entry),
      updatedAt: now,
      createdAt: now,
    };
    await saveNotes(notes);
    // Tag the freshly-written trajectory with the current chat id so cross-chat
    // recall can attribute it. Lazy-imported to avoid a circular dep with
    // notes_store (which transitively imports types from this package).
    try {
      const { resolveCurrentChatId } = await import("./chat_context.js");
      const chatId = resolveCurrentChatId();
      if (chatId) {
        const { notesPaths, pickWritePath } = await import("./global_storage.js");
        const p = await pickWritePath(notesPaths());
        const raw = await readFile(p, "utf8").catch(() => "{}");
        const parsed = JSON.parse(raw) as Record<string, { value?: string; chatId?: string; scope?: string }>;
        const target = parsed[key];
        if (target && typeof target === "object") {
          target.chatId = chatId;
          // Trajectories are always workspace-scoped by default — they're per-project
          // execution history, not durable user identity facts. Sibling chats in the
          // same project may legitimately want to see them; unrelated workspaces won't.
          target.scope = target.scope ?? "workspace";
          await writeFile(p, JSON.stringify(parsed, null, 2), "utf8");
        }
      }
    } catch {
      /* tagging is best-effort — write already succeeded */
    }
    return true;
  } catch {
    return false;
  }
}
