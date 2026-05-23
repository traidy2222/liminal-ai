import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  type TaskWorldBlackboardEntry,
  type TaskWorldEvent,
  type TaskWorldEvidenceEntry,
  type TaskWorldPhase,
  type TaskWorldSnapshot,
  type TaskWorldVerificationCriterion,
  type TaskWorldVerificationStatus,
} from "./types.js";
import { resolveWorkspaceRoot } from "./workspace_root.js";

const MAX_LIST = 80;
const MAX_EVIDENCE = 200;
const MAX_BLACKBOARD = 200;

function clamp(s: string, max: number): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  return oneLine.length <= max ? oneLine : oneLine.slice(0, max - 1) + "...";
}

function uniqAppend(prev: string[], next: string[] | undefined, max = MAX_LIST): string[] {
  const out = [...prev];
  for (const raw of next ?? []) {
    const v = clamp(String(raw), 500);
    if (v && !out.includes(v)) out.push(v);
  }
  return out.slice(-max);
}

export function sanitizeTaskWorldId(input: string): string {
  const cleaned = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return cleaned || `world-${Date.now()}`;
}

export function taskWorldsDir(root = resolveWorkspaceRoot()): string {
  return path.join(root, ".agent_task_worlds");
}

export function taskWorldDir(worldId: string, root = resolveWorkspaceRoot()): string {
  const safe = sanitizeTaskWorldId(worldId);
  return path.join(taskWorldsDir(root), safe);
}

export function taskWorldEventsPath(worldId: string, root = resolveWorkspaceRoot()): string {
  return path.join(taskWorldDir(worldId, root), "events.jsonl");
}

export function taskWorldSnapshotPath(worldId: string, root = resolveWorkspaceRoot()): string {
  return path.join(taskWorldDir(worldId, root), "snapshot.json");
}

export function makeTaskWorldId(objective: string, now = Date.now()): string {
  const words = objective
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 6)
    .join("-");
  return sanitizeTaskWorldId(`${new Date(now).toISOString().slice(0, 10)}-${words || "task"}`);
}

export function createTaskWorldSnapshot(input: {
  id?: string;
  objective: string;
  userConstraints?: string[];
  successCriteria?: string[];
  requiredChecks?: string[];
  now?: number;
}): TaskWorldSnapshot {
  const now = input.now ?? Date.now();
  const id = sanitizeTaskWorldId(input.id ?? makeTaskWorldId(input.objective, now));
  return {
    version: 1,
    id,
    objective: clamp(input.objective, 2000),
    userConstraints: (input.userConstraints ?? []).map((s) => clamp(s, 500)).slice(0, 40),
    phase: "created",
    createdAt: now,
    updatedAt: now,
    openQuestions: [],
    artifacts: [],
    filesTouched: [],
    filesModified: [],
    activeHypotheses: [],
    verification: {
      status: "not_started",
      successCriteria: normalizeCriteria(input.successCriteria ?? [], now),
      requiredChecks: (input.requiredChecks ?? []).map((s) => clamp(s, 500)).slice(0, 40),
      waivedChecks: [],
      residualRisks: [],
    },
    evidence: [],
    blackboard: [],
  };
}

function criterionId(text: string, index: number): string {
  return `crit-${index + 1}-${hashTiny(text)}`;
}

function normalizeCriteria(items: string[], now: number): TaskWorldVerificationCriterion[] {
  return items
    .map((text, i) => clamp(text, 500))
    .filter(Boolean)
    .slice(0, 40)
    .map((text, i) => ({
      id: criterionId(text, i),
      text,
      status: "not_started" as const,
      evidenceIds: [],
      at: now,
    }));
}

function mergeCriteria(
  prev: TaskWorldVerificationCriterion[],
  items: string[] | undefined,
  now: number
): TaskWorldVerificationCriterion[] {
  if (!items || items.length === 0) return prev;
  const out = [...prev];
  for (const raw of items) {
    const text = clamp(String(raw), 500);
    if (!text) continue;
    if (out.some((c) => c.text.toLowerCase() === text.toLowerCase())) continue;
    out.push({
      id: criterionId(text, out.length),
      text,
      status: "not_started",
      evidenceIds: [],
      at: now,
    });
  }
  return out.slice(0, 40);
}

export function applyTaskWorldEvent(
  current: TaskWorldSnapshot | null,
  event: TaskWorldEvent
): TaskWorldSnapshot | null {
  if (event.type === "created") return event.world;
  if (!current) return null;
  const next: TaskWorldSnapshot = { ...current, updatedAt: event.at };
  switch (event.type) {
    case "plan_updated":
      next.phase = event.phase ?? next.phase;
      next.openQuestions = uniqAppend(next.openQuestions, event.openQuestions);
      next.verification = {
        ...next.verification,
        status: next.verification.status === "not_started" ? "in_progress" : next.verification.status,
        successCriteria: mergeCriteria(next.verification.successCriteria, event.successCriteria, event.at),
        requiredChecks: uniqAppend(next.verification.requiredChecks, event.requiredChecks, 40),
      };
      return next;
    case "evidence_added":
      next.evidence = [...next.evidence, event.entry].slice(-MAX_EVIDENCE);
      return next;
    case "verification_updated":
      next.verification = {
        ...next.verification,
        status: event.status ?? next.verification.status,
        residualRisks: uniqAppend(next.verification.residualRisks, event.residualRisks, 40),
        successCriteria: next.verification.successCriteria.map((c) =>
          c.id === event.criterionId
            ? {
                ...c,
                status: event.criterionStatus ?? c.status,
                evidenceIds: uniqAppend(c.evidenceIds, event.evidenceIds, 40),
                ...(event.waivedReason ? { waivedReason: clamp(event.waivedReason, 500) } : {}),
                at: event.at,
              }
            : c
        ),
      };
      return next;
    case "blackboard_added":
      next.blackboard = [...next.blackboard, event.entry].slice(-MAX_BLACKBOARD);
      if (event.entry.kind === "blocker") next.phase = "blocked";
      return next;
    case "artifacts_updated":
      next.artifacts = uniqAppend(next.artifacts, event.artifacts);
      next.filesTouched = uniqAppend(next.filesTouched, event.filesTouched);
      next.filesModified = uniqAppend(next.filesModified, event.filesModified);
      next.activeHypotheses = uniqAppend(next.activeHypotheses, event.activeHypotheses, 40);
      return next;
    case "completed":
      next.phase = "completed";
      next.verification = {
        ...next.verification,
        status: "satisfied",
        residualRisks: uniqAppend(next.verification.residualRisks, event.residualRisks, 40),
      };
      return next;
  }
}

export async function persistTaskWorldEvent(
  worldId: string,
  current: TaskWorldSnapshot | null,
  event: TaskWorldEvent,
  root = resolveWorkspaceRoot()
): Promise<TaskWorldSnapshot> {
  const dir = taskWorldDir(worldId, root);
  await mkdir(dir, { recursive: true });
  const next = applyTaskWorldEvent(current, event);
  if (!next) throw new Error(`Cannot apply ${event.type} before task world creation.`);
  await appendFile(taskWorldEventsPath(worldId, root), JSON.stringify(event) + "\n", "utf8");
  await writeFile(taskWorldSnapshotPath(worldId, root), JSON.stringify(next, null, 2), "utf8");
  return next;
}

export async function loadTaskWorldSnapshot(
  worldId: string,
  root = resolveWorkspaceRoot()
): Promise<TaskWorldSnapshot | null> {
  try {
    const raw = await readFile(taskWorldSnapshotPath(worldId, root), "utf8");
    const parsed = JSON.parse(raw) as TaskWorldSnapshot;
    return parsed?.version === 1 && typeof parsed.id === "string" ? parsed : null;
  } catch {
    return null;
  }
}

export async function reconstructTaskWorldFromEvents(
  worldId: string,
  root = resolveWorkspaceRoot()
): Promise<TaskWorldSnapshot | null> {
  let current: TaskWorldSnapshot | null = null;
  try {
    const raw = await readFile(taskWorldEventsPath(worldId, root), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        current = applyTaskWorldEvent(current, JSON.parse(line) as TaskWorldEvent);
      } catch {
        /* malformed event lines are skipped so recovery can proceed */
      }
    }
    return current;
  } catch {
    return null;
  }
}

export function makeTaskWorldEvidence(input: {
  claim: string;
  sourceKind: TaskWorldEvidenceEntry["sourceKind"];
  sourceRef: string;
  excerpt: string;
  confidence?: TaskWorldEvidenceEntry["confidence"];
  freshness?: TaskWorldEvidenceEntry["freshness"];
  hash?: string;
  now?: number;
}): TaskWorldEvidenceEntry {
  const now = input.now ?? Date.now();
  return {
    id: `ev-${now}-${hashTiny(input.claim + input.sourceRef)}`,
    claim: clamp(input.claim, 700),
    sourceKind: input.sourceKind,
    sourceRef: clamp(input.sourceRef, 500),
    confidence: input.confidence ?? "medium",
    freshness: input.freshness ?? "unknown",
    excerpt: clamp(input.excerpt, 1600),
    ...(input.hash ? { hash: input.hash } : {}),
    at: now,
  };
}

export function makeTaskWorldBlackboardEntry(input: {
  kind: TaskWorldBlackboardEntry["kind"];
  summary: string;
  source?: string;
  payload?: string;
  now?: number;
}): TaskWorldBlackboardEntry {
  const now = input.now ?? Date.now();
  return {
    id: `bb-${now}-${hashTiny(input.kind + input.summary)}`,
    kind: input.kind,
    summary: clamp(input.summary, 700),
    ...(input.source ? { source: clamp(input.source, 300) } : {}),
    ...(input.payload ? { payload: clamp(input.payload, 4000) } : {}),
    at: now,
  };
}

export function formatTaskWorldSummary(world: TaskWorldSnapshot): string {
  const missing = world.verification.successCriteria.filter((c) => c.status !== "satisfied" && c.status !== "waived");
  const blockers = world.blackboard.filter((b) => b.kind === "blocker").slice(-3);
  return [
    "## Active Task World",
    `id: ${world.id}`,
    `objective: ${world.objective.slice(0, 300)}`,
    `phase: ${world.phase}`,
    `verification: ${world.verification.status} (${world.verification.successCriteria.length - missing.length}/${world.verification.successCriteria.length} criteria satisfied/waived)`,
    blockers.length ? `blockers: ${blockers.map((b) => b.summary).join("; ")}` : "",
    world.openQuestions.length ? `open_questions: ${world.openQuestions.slice(-5).join("; ")}` : "",
    world.evidence.length ? `evidence_items: ${world.evidence.length}` : "",
  ].filter(Boolean).join("\n");
}

export function shouldAutoCreateTaskWorld(input: {
  message: string;
  intent?: string;
  openingTurn?: boolean;
  agentDepth?: number;
}): boolean {
  if (input.openingTurn || input.agentDepth && input.agentDepth > 0) return false;
  const msg = input.message.trim();
  if (msg.length > 450) return true;
  if (input.intent && ["coding", "research", "execution"].includes(input.intent)) return true;
  if (/\b(implement|build|refactor|debug|fix|test|review|research|investigate|plan|roadmap|multi[- ]?step|long[- ]?running)\b/i.test(msg)) {
    return true;
  }
  return (msg.match(/\b(and|then|also|after|before)\b/gi) ?? []).length >= 3;
}

export function inferSourceKindFromTool(toolName: string): TaskWorldEvidenceEntry["sourceKind"] {
  if (toolName.includes("web") || toolName === "http_request") return "web";
  if (toolName.includes("browser") || toolName === "vision_analyze") return "browser";
  if (toolName.includes("shell") || toolName.includes("test") || toolName.includes("lint")) return "command";
  if (toolName.includes("file") || toolName === "grep_file" || toolName === "repo_map") return "file";
  return "tool";
}

function hashTiny(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
