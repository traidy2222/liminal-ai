/**
 * Mission continuation — chained sends when a task stays in_progress.
 */
import { readFile, writeFile } from "node:fs/promises";
import { notesPaths, pickReadPath, pickWritePath } from "./global_storage.js";
import { resolveWorkspaceRoot } from "./workspace_root.js";
import { resolveHarnessEnvRaw } from "./harness_effective_env.js";
import type { RuntimePreferences } from "./runtime_prefs.js";
import { readYieldSnapshot, type YieldSnapshot } from "./session_event_log.js";
import type { TurnIntentClass } from "./intent_inference.js";

export interface InProgressTask {
  id: string;
  goal: string;
  status: string;
  nextSteps?: string;
}

type TaskNoteBody = {
  id?: string;
  goal?: string;
  progress_summary?: string;
  next_steps?: string[] | string;
  status?: string;
  updatedAt?: string;
  createdAt?: string;
};

type RawTask = {
  value?: string;
  status?: string;
  updatedAt?: string;
};

function parseTaskNoteBody(raw: string): TaskNoteBody | null {
  try {
    return JSON.parse(raw) as TaskNoteBody;
  } catch {
    return null;
  }
}

function taskEntryRaw(entry: RawTask | string): string {
  return typeof entry === "string" ? entry : String(entry?.value ?? "");
}

function taskStatusFromEntry(entry: RawTask | string, body: TaskNoteBody | null): string {
  if (body?.status) return body.status;
  if (typeof entry === "object" && entry?.status) return String(entry.status);
  return "in_progress";
}

function taskUpdatedAtFromEntry(entry: RawTask | string, body: TaskNoteBody | null): string {
  if (body?.updatedAt) return body.updatedAt;
  if (typeof entry === "object" && entry?.updatedAt) return String(entry.updatedAt);
  return "";
}

function formatNextSteps(next: TaskNoteBody["next_steps"]): string | undefined {
  if (Array.isArray(next)) return next.join(" → ");
  if (typeof next === "string" && next.trim()) return next.trim();
  return undefined;
}

/** User explicitly wants to stop / abandon prior checkpointed work. */
export function userDeclinedMissionResume(userMessage: string): boolean {
  const m = userMessage.trim();
  if (!m) return false;
  return (
    /\b(abandon(?:ed|ing)?|abondoned|stop|cancel(?:led|ing)?|drop|forget)\b.{0,40}\b(task|mission|project|research|kb|checkpoint|work|that|it)\b/i.test(
      m
    ) ||
    /\b(don'?t|do not)\s+(continue|resume|pick up|keep going)\b/i.test(m) ||
    /\b(not continuing|we'?re done|we are done|leave it|new topic|different (task|topic)|ignore (the |that )?(old )?(task|mission))\b/i.test(
      m
    ) ||
    /\b(abandon(?:ed|ing)?|stop)\s*(it|this|that)?\s*[.!]?\s*$/i.test(m)
  );
}

/** User explicitly asked to resume prior checkpointed work. */
export function userRequestedMissionResume(userMessage: string): boolean {
  const m = userMessage.trim();
  if (!m) return false;
  return (
    /\b(resume|continue|pick up|pick back up|keep going|back to)\b.{0,50}\b(task|mission|checkpoint|where we left|research|kb)\b/i.test(
      m
    ) || /\b(resume_task|task_checkpoint)\b/i.test(m)
  );
}

/** Whether to inject [RESUME MISSION] for this user turn. */
export function shouldInjectResumeMission(
  userMessage: string,
  intent?: TurnIntentClass | null
): boolean {
  if (userDeclinedMissionResume(userMessage)) return false;
  if (userRequestedMissionResume(userMessage)) return true;
  if (intent === "conversational") return false;
  return true;
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
      const val = taskEntryRaw(entry);
      const body = parseTaskNoteBody(val);
      const status = taskStatusFromEntry(entry, body);
      if (status !== "in_progress") continue;
      const updatedAt = taskUpdatedAtFromEntry(entry, body);
      if (!best || updatedAt > bestTs) {
        bestTs = updatedAt;
        best = {
          id: key.slice("task:".length),
          goal: body?.goal ?? val.slice(0, 200),
          status,
          nextSteps: formatNextSteps(body?.next_steps),
        };
      }
    }
    return best;
  } catch {
    return null;
  }
}

/** Mark in-progress task checkpoints abandoned (user declined or harness cleared). */
export async function abandonInProgressTasks(opts?: { taskId?: string }): Promise<string[]> {
  const paths = notesPaths(resolveWorkspaceRoot());
  const readPath = await pickReadPath(paths);
  const writePath = await pickWritePath(paths);
  let raw: string;
  try {
    raw = await readFile(readPath, "utf8");
  } catch {
    return [];
  }
  const parsed = JSON.parse(raw) as Record<string, RawTask | string>;
  const abandoned: string[] = [];
  const now = new Date().toISOString();
  let changed = false;
  for (const [key, entry] of Object.entries(parsed)) {
    if (!key.startsWith("task:")) continue;
    const id = key.slice("task:".length);
    if (opts?.taskId && id !== opts.taskId) continue;
    const val = taskEntryRaw(entry);
    const body = parseTaskNoteBody(val);
    if (!body) continue;
    const status = taskStatusFromEntry(entry, body);
    if (status !== "in_progress") continue;
    body.status = "abandoned";
    body.updatedAt = now;
    parsed[key] = JSON.stringify(body);
    abandoned.push(id);
    changed = true;
  }
  if (changed) {
    await writeFile(writePath, JSON.stringify(parsed, null, 2), "utf8");
  }
  return abandoned;
}

export function buildResumeMissionBlock(
  task: InProgressTask,
  yieldSnap: YieldSnapshot | null
): string {
  const lines = [
    "[RESUME MISSION] A prior turn left work in progress. Continue only if the user's latest message aligns with this goal; if they changed topic or abandoned the task, follow them instead.",
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
  lines.push(
    "Call resume_task({ id }) if you need the full checkpoint. " +
      "If the user abandoned or changed topic, call task_checkpoint with status abandoned instead of resuming."
  );
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
