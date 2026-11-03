/**
 * Append-only JSONL session log for replay, debugging, and multi-window handoff.
 * Enable with AGENT_SESSION_JSONL=1; files under .agent_sessions/<sessionId>.jsonl
 *
 * Text logging modes (AGENT_SESSION_JSONL_TEXT_LOG):
 * - `rollup` (default): accumulate streamed assistant text (`channel: "user"`) and emit a
 *   `text_rollup` at tool boundaries and `turn_end` (partial on `error`). Avoids thousands
 *   of per-token JSONL lines.
 * - `delta`: legacy — one `text` line per stream delta (noisy; large files).
 * - `both`: rollup + per-delta lines.
 *
 * Trace / harness lines (`channel: "trace"`) are omitted unless AGENT_SESSION_JSONL_TRACE=1.
 *
 * Yield snapshots: AGENT_YIELD_EVERY_N=<n> writes _yield.json every N rounds for crash recovery.
 */
import { mkdir, appendFile, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import type { AgentEmitter } from "./events.js";
import type { AgentEventMap } from "./types.js";
import { resolveWorkspaceRoot } from "./workspace_root.js";
import { ensurePerChatDirSync, sanitizeChatId } from "./global_storage.js";
import { effectiveHarnessEnvRaw } from "./harness_effective_env.js";

const MAX_USER_CHARS = 12_000;
const MAX_TOOL_OUT_CHARS = 8_000;
/** Cap for a single `text` delta line when AGENT_SESSION_JSONL_TEXT_LOG=delta|both */
const MAX_DELTA_CHARS = 8_000;
const DEFAULT_MAX_ROLLUP_CHARS = 500_000;

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n…[truncated ${s.length - max} chars]`;
}

function resolveMaxRollupChars(): number {
  const raw = effectiveHarnessEnvRaw("AGENT_SESSION_JSONL_MAX_ROLLUP_CHARS")?.trim();
  if (raw) {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 4096) return Math.min(2_000_000, n);
  }
  return DEFAULT_MAX_ROLLUP_CHARS;
}

/** How assistant stream text is written: rollup (default) | delta | both */
export function resolveSessionTextLogMode(): "rollup" | "delta" | "both" {
  const raw = effectiveHarnessEnvRaw("AGENT_SESSION_JSONL_TEXT_LOG")?.trim().toLowerCase();
  if (raw === "delta") return "delta";
  if (raw === "both") return "both";
  return "rollup";
}

export function sessionTraceLogEnabled(): boolean {
  return effectiveHarnessEnvRaw("AGENT_SESSION_JSONL_TRACE") === "1";
}

/**
 * Resolve the directory holding this session's jsonl. Phase 1 storage split:
 * each chat (= sessionId / harness taskId) gets its own subfolder under
 * `~/.liminal/chats/<chatId>/`. Legacy callers that scan `.agent_sessions/`
 * in the workspace can still locate older runs at the legacy path; new writes
 * land in the per-chat dir.
 */
function sessionLogPath(sessionId: string): string {
  const dir = ensurePerChatDirSync(sessionId);
  return path.join(dir, "session.jsonl");
}

/** Legacy `~workspace/.agent_sessions/` path — readers fall back here for old runs. */
function legacySessionLogPath(sessionId: string): string {
  const safe = sanitizeChatId(sessionId);
  return path.join(resolveWorkspaceRoot(), ".agent_sessions", `${safe}.jsonl`);
}

async function appendLine(sessionId: string, record: Record<string, unknown>): Promise<void> {
  const target = sessionLogPath(sessionId);
  await mkdir(path.dirname(target), { recursive: true });
  const line = JSON.stringify({ ts: new Date().toISOString(), sessionId, ...record }) + "\n";
  await appendFile(target, line, "utf8");
}

const pendingSessionWrites = new Map<string, Promise<void>>();
function writeFireAndForget(sessionId: string, record: Record<string, unknown>): void {
  const stamped = { ts: new Date().toISOString(), ...record };
  const pending = (pendingSessionWrites.get(sessionId) ?? Promise.resolve())
    .then(() => appendLine(sessionId, stamped)).catch(() => { /* non-fatal */ });
  pendingSessionWrites.set(sessionId, pending);
  void pending.finally(() => { if (pendingSessionWrites.get(sessionId) === pending) pendingSessionWrites.delete(sessionId); });
}

/**
 * Subscribe to harness emitter and append structured events to `.agent_sessions/<sessionId>.jsonl`.
 * Returns an unsubscribe function. Safe to call multiple times only if you detach previous listeners.
 */
export function attachSessionEventLog(emitter: AgentEmitter, sessionId: string): () => void {
  let assistantRollup = "";
  let turnIndex = 0;

  const write = (record: Record<string, unknown>) => {
    writeFireAndForget(sessionId, record);
  };

  const flushAssistant = (event = "text_rollup") => {
    if (!assistantRollup) return;
    const text = assistantRollup;
    assistantRollup = "";
    write({ event, turnIndex, charCount: text.length, text: truncate(text, resolveMaxRollupChars()) });
  };

  const onSendStart = (p: AgentEventMap["send_start"]) => {
    assistantRollup = "";
    turnIndex += 1;
    write({
      event: "send_start",
      turnIndex,
      agentDepth: p.agentDepth,
      userMessage: truncate(p.userMessage, MAX_USER_CHARS),
    });
  };

  const onToolStart = (p: AgentEventMap["tool_start"]) => {
    flushAssistant();
    write({ event: "tool_start", turnIndex, callId: p.callId, name: p.name });
  };

  const onToolResult = (p: AgentEventMap["tool_result"]) => {
    flushAssistant();
    const out =
      p.result.ok === true
        ? truncate(p.result.output, MAX_TOOL_OUT_CHARS)
        : truncate(p.result.error, MAX_TOOL_OUT_CHARS);
    write({
      event: "tool_result",
      turnIndex,
      callId: p.callId,
      name: p.name,
      args: p.args,
      ok: p.result.ok,
      output: p.result.ok ? out : undefined,
      error: p.result.ok ? undefined : out,
    });
  };

  const onContextCompressed = (p: AgentEventMap["context_compressed"]) => {
    write({
      event: "context_compressed",
      turnIndex,
      beforeFraction: p.beforeFraction,
      afterFraction: p.afterFraction,
      roundsCompressed: p.roundsCompressed,
    });
  };

  const onTurnEnd = (p: AgentEventMap["turn_end"]) => {
    flushAssistant();
    write({event: "turn_end", turnIndex, durationMs: p.durationMs,
      tokenCount: p.contextSnapshot.tokenCount, usageFraction: p.contextSnapshot.usageFraction,
      harnessMetrics: p.harnessMetrics});
  };

  const onError = (p: AgentEventMap["error"]) => {
    flushAssistant("text_rollup_partial");
    write({event: "error", turnIndex, message: truncate(p.err.message, 4000)});
  };

  const onText = (p: AgentEventMap["text"]) => {
    const channel = p.channel ?? "user";
    const mode = resolveSessionTextLogMode();

    if (channel === "trace" && !sessionTraceLogEnabled()) {
      return;
    }

    if (channel === "user") {
      assistantRollup += p.delta;
    }

    if (channel === "trace") {
      write({
        event: "text",
        turnIndex,
        channel,
        delta: truncate(p.delta, MAX_DELTA_CHARS),
      });
      return;
    }

    if (mode === "delta" || mode === "both") {
      write({
        event: "text",
        turnIndex,
        channel,
        delta: truncate(p.delta, MAX_DELTA_CHARS),
      });
    }
  };

  const onProviderRetry = (p: AgentEventMap["provider_retry"]) => {
    write({ event: "provider_retry", turnIndex, ...p });
  };

  const onApproval = (p: AgentEventMap["approval_decision"]) => {
    const editedKeys =
      p.decision === "edit" && p.editedArgs ? Object.keys(p.editedArgs) : undefined;
    write({
      event: "approval_decision",
      turnIndex,
      callId: p.callId,
      name: p.name,
      decision: p.decision,
      ...(editedKeys && editedKeys.length > 0 ? { editedKeys } : {}),
    });
  };

  const onTurnSummary = (p: AgentEventMap["turn_summary"]) => {
    write({ event: "turn_summary", turnIndex, summary: p });
  };

  const onInferenceLatency = (p: AgentEventMap["inference_latency"]) => {
    write({ event: "inference_latency", turnIndex, ...p });
  };

  emitter.on("inference_latency", onInferenceLatency);
  emitter.on("send_start", onSendStart);
  emitter.on("text", onText);
  emitter.on("provider_retry", onProviderRetry);
  emitter.on("tool_start", onToolStart);
  emitter.on("tool_result", onToolResult);
  emitter.on("context_compressed", onContextCompressed);
  emitter.on("turn_summary", onTurnSummary);
  emitter.on("turn_end", onTurnEnd);
  emitter.on("error", onError);
  emitter.on("approval_decision", onApproval);

  return () => {
    emitter.off("inference_latency", onInferenceLatency);
    emitter.off("send_start", onSendStart);
    emitter.off("text", onText);
    emitter.off("provider_retry", onProviderRetry);
    emitter.off("tool_start", onToolStart);
    emitter.off("tool_result", onToolResult);
    emitter.off("context_compressed", onContextCompressed);
    emitter.off("turn_summary", onTurnSummary);
    emitter.off("turn_end", onTurnEnd);
    emitter.off("error", onError);
    emitter.off("approval_decision", onApproval);
  };
}

export interface YieldSnapshot {
  taskId: string;
  round: number;
  goal: string;
  toolsUsed: string[];
  usageFraction: number;
  tokenCount: number;
  epistemicSummary?: string;
  savedAt: string;
}

function yieldSnapshotPath(taskId: string): string {
  // Stored alongside the per-chat session log under ~/.liminal/chats/<chatId>/.
  return path.join(ensurePerChatDirSync(taskId), "yield.json");
}

/**
 * Write a crash-recovery yield snapshot under `~/.liminal/chats/<chatId>/yield.json`.
 * Called every AGENT_YIELD_EVERY_N rounds when that env var is set.
 */
export async function writeYieldSnapshot(snapshot: YieldSnapshot): Promise<void> {
  try {
    const target = yieldSnapshotPath(snapshot.taskId);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify(snapshot, null, 2), "utf8");
  } catch {
    /* non-fatal */
  }
}

/** Read the latest yield snapshot for crash/mission resume (null if missing). */
export async function readYieldSnapshot(taskId: string): Promise<YieldSnapshot | null> {
  try {
    const raw = await readFile(yieldSnapshotPath(taskId), "utf8");
    return JSON.parse(raw) as YieldSnapshot;
  } catch {
    return null;
  }
}

// Surface the legacy path for readers that want to scan old session jsonl files
// (auto_dream session scan, etc). Suppress unused-binding warning — exported
// indirectly via callers that import the symbol when they need it.
export { legacySessionLogPath };

/** When AGENT_SESSION_JSONL=1, attach logging and return detach; otherwise return a no-op. */
export function maybeAttachSessionEventLog(
  emitter: AgentEmitter,
  sessionId: string
): () => void {
  if (effectiveHarnessEnvRaw("AGENT_SESSION_JSONL") !== "1") return () => {};
  return attachSessionEventLog(emitter, sessionId);
}
