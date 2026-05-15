/**
 * Append-only JSONL session log for replay, debugging, and multi-window handoff.
 * Enable with AGENT_SESSION_JSONL=1; files under .agent_sessions/<sessionId>.jsonl
 *
 * Text logging modes (AGENT_SESSION_JSONL_TEXT_LOG):
 * - `rollup` (default): accumulate streamed assistant text (`channel: "user"`) and emit one
 *   `text_rollup` record on `turn_end` (and `text_rollup_partial` on `error`). Avoids thousands
 *   of per-token JSONL lines.
 * - `delta`: legacy — one `text` line per stream delta (noisy; large files).
 * - `both`: rollup + per-delta lines.
 *
 * Trace / harness lines (`channel: "trace"`) are omitted unless AGENT_SESSION_JSONL_TRACE=1.
 *
 * Yield snapshots: AGENT_YIELD_EVERY_N=<n> writes _yield.json every N rounds for crash recovery.
 */
import { mkdir, appendFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentEmitter } from "./events.js";
import type { AgentEventMap } from "./types.js";
import { resolveWorkspaceRoot } from "./workspace_root.js";
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

function sessionLogDir(): string {
  return path.join(resolveWorkspaceRoot(), ".agent_sessions");
}

function sessionLogPath(sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  return path.join(sessionLogDir(), `${safe}.jsonl`);
}

async function appendLine(sessionId: string, record: Record<string, unknown>): Promise<void> {
  const dir = sessionLogDir();
  await mkdir(dir, { recursive: true });
  const line = JSON.stringify({ ts: new Date().toISOString(), sessionId, ...record }) + "\n";
  await appendFile(sessionLogPath(sessionId), line, "utf8");
}

function writeFireAndForget(sessionId: string, record: Record<string, unknown>): void {
  void appendLine(sessionId, record).catch(() => {
    /* avoid throwing into emitter */
  });
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
    write({ event: "tool_start", turnIndex, callId: p.callId, name: p.name });
  };

  const onToolResult = (p: AgentEventMap["tool_result"]) => {
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
    const snapRollup = assistantRollup;
    const rollupTurnIndex = turnIndex;
    assistantRollup = "";
    void (async () => {
      try {
        if (snapRollup) {
          await appendLine(sessionId, {
            event: "text_rollup",
            turnIndex: rollupTurnIndex,
            charCount: snapRollup.length,
            text: truncate(snapRollup, resolveMaxRollupChars()),
          });
        }
        await appendLine(sessionId, {
          event: "turn_end",
          turnIndex: rollupTurnIndex,
          durationMs: p.durationMs,
          tokenCount: p.contextSnapshot.tokenCount,
          usageFraction: p.contextSnapshot.usageFraction,
          harnessMetrics: p.harnessMetrics,
        });
      } catch {
        /* non-fatal */
      }
    })();
  };

  const onError = (p: AgentEventMap["error"]) => {
    const snapRollup = assistantRollup;
    const rollupTurnIndex = turnIndex;
    assistantRollup = "";
    void (async () => {
      try {
        if (snapRollup) {
          await appendLine(sessionId, {
            event: "text_rollup_partial",
            turnIndex: rollupTurnIndex,
            charCount: snapRollup.length,
            text: truncate(snapRollup, resolveMaxRollupChars()),
          });
        }
        await appendLine(sessionId, {
          event: "error",
          turnIndex: rollupTurnIndex,
          message: truncate(p.err.message, 4000),
        });
      } catch {
        /* non-fatal */
      }
    })();
  };

  const onText = (p: AgentEventMap["text"]) => {
    const channel = p.channel ?? "user";
    const mode = resolveSessionTextLogMode();

    if (channel === "trace" && !sessionTraceLogEnabled()) {
      return;
    }

    if (channel !== "trace") {
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

  emitter.on("send_start", onSendStart);
  emitter.on("text", onText);
  emitter.on("provider_retry", onProviderRetry);
  emitter.on("tool_start", onToolStart);
  emitter.on("tool_result", onToolResult);
  emitter.on("context_compressed", onContextCompressed);
  emitter.on("turn_end", onTurnEnd);
  emitter.on("error", onError);
  emitter.on("approval_decision", onApproval);

  return () => {
    emitter.off("send_start", onSendStart);
    emitter.off("text", onText);
    emitter.off("provider_retry", onProviderRetry);
    emitter.off("tool_start", onToolStart);
    emitter.off("tool_result", onToolResult);
    emitter.off("context_compressed", onContextCompressed);
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
  const safe = taskId.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  return path.join(sessionLogDir(), `${safe}_yield.json`);
}

/**
 * Write a crash-recovery yield snapshot to `.agent_sessions/<taskId>_yield.json`.
 * Called every AGENT_YIELD_EVERY_N rounds when that env var is set.
 */
export async function writeYieldSnapshot(snapshot: YieldSnapshot): Promise<void> {
  try {
    const dir = sessionLogDir();
    await mkdir(dir, { recursive: true });
    await writeFile(
      yieldSnapshotPath(snapshot.taskId),
      JSON.stringify(snapshot, null, 2),
      "utf8"
    );
  } catch {
    /* non-fatal */
  }
}

/** When AGENT_SESSION_JSONL=1, attach logging and return detach; otherwise return a no-op. */
export function maybeAttachSessionEventLog(
  emitter: AgentEmitter,
  sessionId: string
): () => void {
  if (effectiveHarnessEnvRaw("AGENT_SESSION_JSONL") !== "1") return () => {};
  return attachSessionEventLog(emitter, sessionId);
}
