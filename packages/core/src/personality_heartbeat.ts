/**
 * Optional idle "personality heartbeat": bounded fast-model JSON tick + safe remember() writes.
 * Defaults off (AGENT_HEARTBEAT unset or not "1").
 */
import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import type OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";
import type { ToolDispatcher } from "./dispatcher.js";
import type { RuntimePreferences } from "./runtime_prefs.js";
import { resolveHarnessEnvRaw } from "./harness_effective_env.js";
import { resolveWorkspaceRoot } from "./workspace_root.js";
import { completeChatJson, getFastModelSlug } from "./router.js";
import { formatFailureDigestForWorldContext } from "./failure_digest.js";

const MEMORY_TYPES = new Set([
  "fact",
  "experience",
  "entity",
  "belief",
  "reflection",
  "recipe",
  "hypothesis",
  "trajectory",
]);

export interface PersonalityHeartbeatConfig {
  enabled: boolean;
  idleMs: number;
  minIntervalMs: number;
  maxTokens: number;
  timeoutMs: number;
  surface: "off" | "trace" | "assistant";
  maxUserNudgesPerHour: number;
  userNudgeConfidenceMin: number;
  uiStripDefault: boolean;
}

export function resolvePersonalityHeartbeatConfig(
  prefs: RuntimePreferences | null
): PersonalityHeartbeatConfig {
  const enabled = resolveHarnessEnvRaw("AGENT_HEARTBEAT", prefs)?.trim() === "1";
  const idleMs = Math.max(
    5_000,
    Math.min(600_000, parseInt(resolveHarnessEnvRaw("AGENT_HEARTBEAT_IDLE_MS", prefs) ?? "45000", 10) || 45_000)
  );
  const minIntervalMs = Math.max(
    10_000,
    Math.min(3_600_000, parseInt(resolveHarnessEnvRaw("AGENT_HEARTBEAT_MIN_INTERVAL_MS", prefs) ?? "120000", 10) || 120_000)
  );
  const maxTokens = Math.max(
    64,
    Math.min(2048, parseInt(resolveHarnessEnvRaw("AGENT_HEARTBEAT_MAX_TOKENS", prefs) ?? "512", 10) || 512)
  );
  const timeoutMs = Math.max(
    3_000,
    Math.min(120_000, parseInt(resolveHarnessEnvRaw("AGENT_HEARTBEAT_TIMEOUT_MS", prefs) ?? "20000", 10) || 20_000)
  );
  const surfaceRaw = (resolveHarnessEnvRaw("AGENT_HEARTBEAT_SURFACE", prefs) ?? "trace").trim().toLowerCase();
  const surface: PersonalityHeartbeatConfig["surface"] =
    surfaceRaw === "off" ? "off" : surfaceRaw === "assistant" ? "assistant" : "trace";
  const maxUserNudgesPerHour = Math.max(
    0,
    Math.min(24, parseInt(resolveHarnessEnvRaw("AGENT_HEARTBEAT_MAX_USER_NUDGES_PER_HOUR", prefs) ?? "2", 10) || 2)
  );
  const userNudgeConfidenceMin = Math.max(
    0.5,
    Math.min(
      0.99,
      parseFloat(resolveHarnessEnvRaw("AGENT_HEARTBEAT_USER_NUDGE_CONFIDENCE_MIN", prefs) ?? "0.86") || 0.86
    )
  );
  const uiStripDefault = resolveHarnessEnvRaw("AGENT_HEARTBEAT_UI_STRIP", prefs)?.trim() === "1";
  return {
    enabled,
    idleMs,
    minIntervalMs,
    maxTokens,
    timeoutMs,
    surface,
    maxUserNudgesPerHour,
    userNudgeConfidenceMin,
    uiStripDefault,
  };
}

export function personalityHeartbeatLogPath(): string {
  return join(resolveWorkspaceRoot(), ".agent_heartbeat.jsonl");
}

export interface HeartbeatLogRecord {
  ts: string;
  taskId: string;
  runId: string;
  trigger: "idle_tick";
  summary: string;
  reflections?: string[];
  memoryWrites?: number;
  surfaceDecision: string;
  nudgeText?: string;
  skippedReason?: string;
  durationMs?: number;
}

export async function appendPersonalityHeartbeatLog(rec: HeartbeatLogRecord): Promise<void> {
  const line = `${JSON.stringify(rec)}\n`;
  await appendFile(personalityHeartbeatLogPath(), line, "utf8");
}

/** Last N non-empty lines from the heartbeat log for tick context (bounded I/O). */
export async function readPersonalityHeartbeatLogTail(maxLines = 12): Promise<string> {
  let raw: string;
  try {
    raw = await readFile(personalityHeartbeatLogPath(), "utf8");
  } catch {
    return "";
  }
  const lines = raw.split("\n").filter(Boolean).slice(-maxLines);
  const snippets: string[] = [];
  for (const line of lines) {
    try {
      const o = JSON.parse(line) as Partial<HeartbeatLogRecord>;
      if (typeof o.summary === "string" && o.summary.trim()) {
        snippets.push(o.summary.trim().slice(0, 160));
      }
    } catch {
      /* skip */
    }
  }
  return snippets.length ? snippets.join(" | ") : "";
}

export interface HeartbeatTickParsed {
  reflections: string[];
  memory_candidates: Array<{ key: string; type?: string; value: string }>;
  user_nudge: null | { text: string; confidence: number; rationale?: string };
  defer_ms?: number;
}

export function parseHeartbeatTickJson(parsed: unknown): HeartbeatTickParsed | null {
  if (!parsed || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;
  const reflectionsRaw = o.reflections;
  const reflections = Array.isArray(reflectionsRaw)
    ? reflectionsRaw
        .filter((x): x is string => typeof x === "string")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 8)
    : [];
  const rawMc = o.memory_candidates;
  const memory_candidates: HeartbeatTickParsed["memory_candidates"] = [];
  if (Array.isArray(rawMc)) {
    for (const item of rawMc.slice(0, 4)) {
      if (!item || typeof item !== "object") continue;
      const m = item as Record<string, unknown>;
      if (typeof m.key !== "string" || typeof m.value !== "string") continue;
      const key = m.key.trim().slice(0, 120);
      const value = m.value.trim().slice(0, 2000);
      if (!key || !value) continue;
      const t = typeof m.type === "string" ? m.type.trim() : undefined;
      if (t && !MEMORY_TYPES.has(t)) continue;
      memory_candidates.push({ key, ...(t ? { type: t } : {}), value });
    }
  }
  let user_nudge: HeartbeatTickParsed["user_nudge"] = null;
  if (o.user_nudge != null && typeof o.user_nudge === "object") {
    const u = o.user_nudge as Record<string, unknown>;
    if (typeof u.text === "string" && typeof u.confidence === "number" && Number.isFinite(u.confidence)) {
      const text = u.text.trim().slice(0, 400);
      if (text.length > 0) {
        user_nudge = {
          text,
          confidence: Math.max(0, Math.min(1, u.confidence)),
          ...(typeof u.rationale === "string" ? { rationale: u.rationale.trim().slice(0, 400) } : {}),
        };
      }
    }
  }
  return { reflections, memory_candidates, user_nudge, defer_ms: typeof o.defer_ms === "number" ? o.defer_ms : undefined };
}

export type HeartbeatSurfaceDecision = "none" | "trace" | "assistant";

export function decideUserNudgeSurface(input: {
  cfg: PersonalityHeartbeatConfig;
  tick: HeartbeatTickParsed;
  nudgeTimestampsHour: number[];
}): { decision: HeartbeatSurfaceDecision; nudgeText?: string; reason?: string } {
  const n = input.tick.user_nudge;
  if (!n || input.cfg.surface === "off") {
    return { decision: "none", reason: input.cfg.surface === "off" ? "surface_off" : "no_nudge" };
  }
  if (n.confidence < input.cfg.userNudgeConfidenceMin) {
    return { decision: "none", reason: "confidence_below_min" };
  }
  if (input.cfg.maxUserNudgesPerHour <= 0) {
    return { decision: "none", reason: "nudges_disabled" };
  }
  const hourAgo = Date.now() - 3_600_000;
  const recent = input.nudgeTimestampsHour.filter((t) => t > hourAgo);
  if (recent.length >= input.cfg.maxUserNudgesPerHour) {
    return { decision: "none", reason: "hourly_cap" };
  }
  if (input.cfg.surface === "assistant") {
    return { decision: "assistant", nudgeText: n.text };
  }
  return { decision: "trace", nudgeText: n.text };
}

function buildHeartbeatMessages(input: {
  personaLabel: string;
  lastUserExcerpt: string;
  toolsUsed: string[];
  failureDigestLine: string | null;
  memorySearchExcerpt: string | null;
  priorPulseSnippets: string;
}): ChatCompletionMessageParam[] {
  const toolLine = input.toolsUsed.length ? input.toolsUsed.slice(0, 20).join(", ") : "(none)";
  const sys =
    "You are a harness background reflection module (not a user-facing chat actor). " +
    "Output a single JSON object only (no markdown) matching this shape:\n" +
    '{"reflections":["string",...],"memory_candidates":[{"key":"string","type":"reflection","value":"string"}...],' +
    '"user_nudge":null|{"text":"string","confidence":0-1,"rationale":"string"},' +
    '"defer_ms":number}\n' +
    "Rules:\n" +
    "- reflections: 1-4 short internal bullets (no user addressing).\n" +
    "- memory_candidates: 0-3 items; keys short; values compact; prefer type reflection or hypothesis.\n" +
    "- user_nudge: only if there is a high-value, non-obvious follow-up for the user; otherwise null. " +
    "Never shame, moralize, or invent user state.\n" +
    "- defer_ms: suggested ms before another heartbeat (5000-300000).\n" +
    `Persona label: ${input.personaLabel}\n` +
    (input.priorPulseSnippets ? `Recent pulse summaries: ${input.priorPulseSnippets}\n` : "") +
    (input.failureDigestLine ? `Failure digest: ${input.failureDigestLine}\n` : "") +
    (input.memorySearchExcerpt ? `Notes search excerpt: ${input.memorySearchExcerpt}\n` : "");
  const user =
    `Last user turn (excerpt): ${input.lastUserExcerpt}\n` + `Tools used last turn: ${toolLine}\n`;
  return [
    { role: "system", content: sys },
    { role: "user", content: user },
  ];
}

export interface ExecutePersonalityHeartbeatOpts {
  prefs: RuntimePreferences | null;
  client: OpenAI;
  mainModelSlug: string;
  dispatcher: ToolDispatcher;
  taskId: string;
  runId: string;
  personaLabel: string;
  lastUserMessage: string;
  toolsUsedThisTurn: string[];
  registryHas: (name: string) => boolean;
  nudgeTimestampsHour: number[];
}

export interface ExecutePersonalityHeartbeatResult {
  runId: string;
  durationMs: number;
  summary: string;
  reflectionsPreview: string[];
  memoryWrites: number;
  surfaceDecision: HeartbeatSurfaceDecision;
  nudgeText?: string;
  error?: string;
}

export async function executePersonalityHeartbeat(
  opts: ExecutePersonalityHeartbeatOpts
): Promise<ExecutePersonalityHeartbeatResult> {
  const cfg = resolvePersonalityHeartbeatConfig(opts.prefs);
  const runId = opts.runId;
  const started = Date.now();
  const fast = getFastModelSlug(opts.mainModelSlug);

  const prior = await readPersonalityHeartbeatLogTail(10);
  let memorySearchExcerpt: string | null = null;
  if (opts.registryHas("search_memory") && opts.lastUserMessage.trim().length > 3) {
    const q = opts.lastUserMessage.trim().slice(0, 200);
    const sr = await opts.dispatcher.directCall("search_memory", { query: q });
    if (sr.ok && typeof sr.output === "string") {
      memorySearchExcerpt = sr.output.replace(/\s+/g, " ").trim().slice(0, 900);
    }
  }

  let failureDigestLine: string | null = null;
  try {
    failureDigestLine = await formatFailureDigestForWorldContext();
  } catch {
    failureDigestLine = null;
  }

  const messages = buildHeartbeatMessages({
    personaLabel: opts.personaLabel,
    lastUserExcerpt: opts.lastUserMessage.trim().slice(0, 1200),
    toolsUsed: opts.toolsUsedThisTurn,
    failureDigestLine,
    memorySearchExcerpt,
    priorPulseSnippets: prior.slice(0, 1500),
  });

  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), cfg.timeoutMs);
  let json = await completeChatJson(opts.client, {
    model: fast,
    messages,
    maxTokens: cfg.maxTokens,
    temperature: 0.15,
    signal: ac.signal,
  });
  clearTimeout(to);

  if (!json.ok) {
    const durationMs = Date.now() - started;
    return {
      runId,
      durationMs,
      summary: "tick failed",
      reflectionsPreview: [],
      memoryWrites: 0,
      surfaceDecision: "none",
      error: json.error,
    };
  }

  const tick = parseHeartbeatTickJson(json.parsed);
  if (!tick) {
    const durationMs = Date.now() - started;
    return {
      runId,
      durationMs,
      summary: "invalid tick JSON",
      reflectionsPreview: [],
      memoryWrites: 0,
      surfaceDecision: "none",
      error: "parse",
    };
  }

  let memoryWrites = 0;
  if (opts.registryHas("remember")) {
    for (const c of tick.memory_candidates) {
      const args: Record<string, unknown> = {
        key: `heartbeat:${c.key}`.replace(/[^\w\-:.]/g, "_").slice(0, 128),
        value: c.value,
        ...(c.type ? { type: c.type } : { type: "reflection" }),
        actor_id: opts.taskId,
      };
      const r = await opts.dispatcher.directCall("remember", args);
      if (r.ok) memoryWrites += 1;
    }
  }

  const surface = decideUserNudgeSurface({
    cfg,
    tick,
    nudgeTimestampsHour: opts.nudgeTimestampsHour,
  });

  const reflectionsPreview = tick.reflections.slice(0, 3);
  const summary =
    memoryWrites > 0
      ? `Pulse · consolidated memory · ${memoryWrites} note(s)`
      : tick.reflections[0]
        ? `Pulse · ${tick.reflections[0]!.slice(0, 72)}${tick.reflections[0]!.length > 72 ? "…" : ""}`
        : "Pulse · idle reflection";

  const durationMs = Date.now() - started;
  return {
    runId,
    durationMs,
    summary,
    reflectionsPreview,
    memoryWrites,
    surfaceDecision: surface.decision,
    ...(surface.nudgeText ? { nudgeText: surface.nudgeText } : {}),
  };
}
