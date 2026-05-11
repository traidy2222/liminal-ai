import { mkdir, readdir, readFile, stat, unlink, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveWorkspaceRoot } from "./workspace_root.js";

export interface AutoDreamConfig {
  enabled: boolean;
  minHours: number;
  minSessions: number;
  scanIntervalMs: number;
  maxSessionFiles: number;
  maxCharsPerSession: number;
  maxTotalChars: number;
  lockStaleMs: number;
}

function clampInt(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return clampInt(n, min, max);
}

export function resolveAutoDreamConfig(): AutoDreamConfig {
  return {
    enabled: process.env["AGENT_AUTO_DREAM"] === "1",
    // Allow 0 to force immediate eligibility during smoke testing.
    minHours: envInt("AGENT_AUTO_DREAM_MIN_HOURS", 24, 0, 24 * 30),
    minSessions: envInt("AGENT_AUTO_DREAM_MIN_SESSIONS", 5, 1, 500),
    // Allow 0 to disable throttle during validation loops.
    scanIntervalMs: envInt("AGENT_AUTO_DREAM_SCAN_INTERVAL_MS", 10 * 60_000, 0, 24 * 60 * 60_000),
    maxSessionFiles: envInt("AGENT_AUTO_DREAM_MAX_SESSION_FILES", 8, 1, 60),
    maxCharsPerSession: envInt("AGENT_AUTO_DREAM_MAX_CHARS_PER_SESSION", 10_000, 500, 50_000),
    maxTotalChars: envInt("AGENT_AUTO_DREAM_MAX_TOTAL_CHARS", 40_000, 2_000, 200_000),
    lockStaleMs: envInt("AGENT_AUTO_DREAM_LOCK_STALE_MS", 60 * 60_000, 60_000, 7 * 24 * 60 * 60_000),
  };
}

function sessionLogDir(): string {
  return path.join(resolveWorkspaceRoot(), ".agent_sessions");
}

function lockPath(): string {
  return path.join(sessionLogDir(), ".consolidate-lock");
}

function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function readLastConsolidatedAt(): Promise<number> {
  try {
    const s = await stat(lockPath());
    return s.mtimeMs;
  } catch {
    return 0;
  }
}

export async function tryAcquireConsolidationLock(
  staleMs: number
): Promise<number | null> {
  const p = lockPath();
  let priorMtime: number | undefined;
  let holderPid: number | undefined;
  try {
    const [s, raw] = await Promise.all([stat(p), readFile(p, "utf8")]);
    priorMtime = s.mtimeMs;
    const parsed = parseInt(raw.trim(), 10);
    if (Number.isFinite(parsed)) holderPid = parsed;
  } catch {
    // missing lock
  }

  if (priorMtime !== undefined && Date.now() - priorMtime < staleMs) {
    if (holderPid && holderPid !== process.pid && isPidAlive(holderPid)) return null;
  }

  await mkdir(sessionLogDir(), { recursive: true });
  await writeFile(p, String(process.pid), "utf8");
  const verify = await readFile(p, "utf8").catch(() => "");
  if (parseInt(verify.trim(), 10) !== process.pid) return null;
  return priorMtime ?? 0;
}

export async function rollbackConsolidationLock(priorMtime: number): Promise<void> {
  const p = lockPath();
  try {
    if (priorMtime === 0) {
      await unlink(p);
      return;
    }
    await writeFile(p, "", "utf8");
    const t = priorMtime / 1000;
    await utimes(p, t, t);
  } catch {
    // best effort
  }
}

export async function listSessionsTouchedSince(
  sinceMs: number,
  currentSessionId?: string
): Promise<string[]> {
  let files: string[] = [];
  try {
    files = await readdir(sessionLogDir());
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const f of files) {
    if (!f.endsWith(".jsonl")) continue;
    if (f.endsWith("_yield.jsonl")) continue;
    const sessionId = f.slice(0, -".jsonl".length);
    if (currentSessionId && sessionId === currentSessionId) continue;
    try {
      const s = await stat(path.join(sessionLogDir(), f));
      if (s.mtimeMs > sinceMs) out.push(sessionId);
    } catch {
      // ignore races
    }
  }
  return out.sort();
}

export async function loadRecentSessionSnippets(
  sessionIds: string[],
  maxFiles: number,
  maxCharsPerSession: number,
  maxTotalChars: number
): Promise<Array<{ sessionId: string; snippet: string }>> {
  const picked = sessionIds.slice(-maxFiles);
  const out: Array<{ sessionId: string; snippet: string }> = [];
  let used = 0;
  for (const id of picked) {
    const p = path.join(sessionLogDir(), `${id}.jsonl`);
    try {
      const raw = await readFile(p, "utf8");
      const tail = raw.slice(-maxCharsPerSession).trim();
      const remain = Math.max(0, maxTotalChars - used);
      if (remain <= 0) break;
      const clipped = tail.slice(0, remain);
      if (!clipped) continue;
      out.push({ sessionId: id, snippet: clipped });
      used += clipped.length;
    } catch {
      // ignore missing files/races
    }
  }
  return out;
}

export function buildAutoDreamPrompt(input: {
  notesSnapshot: string;
  sessions: Array<{ sessionId: string; snippet: string }>;
}): string {
  const sessionsBlock =
    input.sessions.length === 0
      ? "(none)"
      : input.sessions
          .map((s) => `## Session ${s.sessionId}\n${s.snippet}`)
          .join("\n\n");
  return (
    "You are running a memory-consolidation dream for an agent note store.\n" +
    "Review recent session traces and current note snapshot, then return JSON only.\n\n" +
    "Output schema:\n" +
    "{\n" +
    '  "summary": "short plain-language consolidation summary",\n' +
    '  "upserts": [{"type":"fact|experience|entity|belief|reflection|recipe","key":"short_snake_case","value":"durable memory text"}],\n' +
    '  "deletes": [{"key":"typed_or_untyped_key","reason":"why stale/incorrect"}]\n' +
    "}\n\n" +
    "Rules:\n" +
    "- Prefer high-signal durable memories; avoid ephemeral tool noise.\n" +
    "- Normalize relative time to concrete dates where possible.\n" +
    "- Keep upserts concise and non-duplicative.\n" +
    "- Use deletes only for contradicted or obsolete memories.\n\n" +
    "Current notes snapshot:\n" +
    input.notesSnapshot +
    "\n\nRecent sessions:\n" +
    sessionsBlock
  );
}

