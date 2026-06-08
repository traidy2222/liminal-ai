/**
 * Mission continuation — chained sends when a task stays in_progress.
 */
import { readFile } from "node:fs/promises";
import { notesPaths, pickReadPath } from "./global_storage.js";
import { resolveWorkspaceRoot } from "./workspace_root.js";
import { resolveHarnessEnvRaw } from "./harness_effective_env.js";
import type { RuntimePreferences } from "./runtime_prefs.js";
import { readYieldSnapshot, type YieldSnapshot } from "./session_event_log.js";

export interface InProgressTask {
  id: string;
  goal: string;
  status: string;
  nextSteps?: string;
}

type RawTask = {
  value?: string;
  status?: string;
};

function parseTaskValue(raw: string): { goal?: string; next_steps?: string; status?: string } | null {
  try {
    const j = JSON.parse(raw) as { goal?: string; next_steps?: string; status?: string };
    return j;
  } catch {
    return null;
  }
}

export function resolveMissionAutonomyConfig(prefs: RuntimePreferences | null = null): {
  enabled: boolean;
  maxIterations: number;
  requiresYolo: boolean;
} {
  const enabled = resolveHarnessEnvRaw("AGENT_MISSION_AUTONOMY", prefs) === "1";
  const raw = resolveHarnessEnvRaw("AGENT_MISSION_MAX_ITERATIONS", prefs)?.trim();
  const n = raw ? parseInt(raw, 10) : 20;
  const maxIterations = Number.isFinite(n) ? Math.max(1, Math.min(100, n)) : 20;
  const requiresYolo = resolveHarnessEnvRaw("AGENT_MISSION_REQUIRES_YOLO", prefs) === "1";
  return { enabled, maxIterations, requiresYolo };
}

export async function loadLatestInProgressTask(): Promise<InProgressTask | null> {
  try {
    const p = await pickReadPath(notesPaths(resolveWorkspaceRoot()));
    const raw = await readFile(p, "utf8");
    const parsed = JSON.parse(raw) as Record<string, RawTask | string>;
    let best: InProgressTask | null = null;
    let bestTs = "";
    for (const [key, entry] of Object.entries(parsed)) {
      if (!key.startsWith("task:")) continue;
      const val = typeof entry === "string" ? entry : String(entry?.value ?? "");
      const body = parseTaskValue(val);
      const status =
        body?.status ??
        (typeof entry === "object" && entry?.status ? String(entry.status) : "in_progress");
      if (status !== "in_progress") continue;
      const updatedAt =
        typeof entry === "object" && entry && "updatedAt" in entry
          ? String((entry as { updatedAt?: string }).updatedAt ?? "")
          : "";
      if (!best || updatedAt > bestTs) {
        bestTs = updatedAt;
        best = {
          id: key.slice("task:".length),
          goal: body?.goal ?? val.slice(0, 200),
          status,
          nextSteps: body?.next_steps,
        };
      }
    }
    return best;
  } catch {
    return null;
  }
}

export function buildResumeMissionBlock(
  task: InProgressTask,
  yieldSnap: YieldSnapshot | null
): string {
  const lines = [
    "[RESUME MISSION] A prior turn left work in progress. Continue the mission without waiting for a new user instruction.",
    `Task id: task:${task.id}`,
    `Goal: ${task.goal.slice(0, 500)}`,
  ];
  if (task.nextSteps?.trim()) {
    lines.push(`Next steps: ${task.nextSteps.trim().slice(0, 800)}`);
  }
  if (yieldSnap) {
    lines.push(
      `Last harness round: ${yieldSnap.round}`,
      `Yield goal: ${yieldSnap.goal.slice(0, 300)}`,
      yieldSnap.epistemicSummary ? `Epistemic: ${yieldSnap.epistemicSummary.slice(0, 400)}` : ""
    );
  }
  lines.push("Call resume_task({ id }) if you need the full checkpoint, then continue the plan.");
  return lines.filter(Boolean).join("\n");
}

export interface MissionContinueDecision {
  continue: boolean;
  userMessage?: string;
  reason?: string;
}

export async function evaluateMissionContinue(input: {
  taskId: string;
  prefs?: RuntimePreferences | null | undefined;
  yolo: boolean;
  chainedSendsThisMission: number;
  userAborted: boolean;
  terminationReason: string;
}): Promise<MissionContinueDecision> {
  const cfg = resolveMissionAutonomyConfig(input.prefs ?? null);
  if (!cfg.enabled) return { continue: false, reason: "disabled" };
  if (input.terminationReason !== "ok") return { continue: false, reason: "bad_termination" };
  if (input.userAborted) return { continue: false, reason: "aborted" };
  if (cfg.requiresYolo && !input.yolo) return { continue: false, reason: "requires_yolo" };
  if (input.chainedSendsThisMission >= cfg.maxIterations) {
    return { continue: false, reason: "max_iterations" };
  }

  const task = await loadLatestInProgressTask();
  if (!task) return { continue: false, reason: "no_in_progress_task" };

  const msg =
    `[mission_continue] Continue task:${task.id}. ` +
    (task.nextSteps?.trim() || "Pick up the next step and execute it.") +
    " Report progress when done.";

  return { continue: true, userMessage: msg, reason: "in_progress_task" };
}
