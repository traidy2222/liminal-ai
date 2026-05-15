import { useEffect, useReducer, useCallback, useRef } from "react";
import type { PersonaUiThemeV1 } from "@liminal/core/persona-ui-theme";
import type { ImageAttachment } from "./imageAttachments.js";
import { readPersonaChromeFromSession, writePersonaChromeToSession } from "./personaChromeSessionCache.js";

function sanitizeDeltaText(text: string): string {
  return text
    .replace(/�/g, "")
    .replace(/\s*⚙\s*/g, " ")
    .replace(/\r/g, "");
}

export type MessageEntry =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string; streaming: boolean }
  | { kind: "provider_retry"; text: string }
  | {
      kind: "tool_call";
      callId: string;
      name: string;
      argsJson: string;
      status: "streaming" | "pending_approval" | "running" | "done" | "error";
      startedAt: number;
      endedAt?: number;
    }
  | { kind: "tool_result"; callId: string; output: string; ok: boolean }
  | { kind: "think"; content: string }
  | { kind: "plan"; steps: string[] }
  | { kind: "trace"; text: string }
  | { kind: "pulse_nudge"; text: string; at: number }
  | {
      kind: "subtask";
      taskId: string;
      parentTaskId: string;
      goal: string;
      depth: number;
      status: "running" | "done" | "error" | "cancelled";
      partialOutput: string;
    }
  | { kind: "context_compressed"; beforePct: number; afterPct: number; rounds: number };

interface ContextSnapshot {
  tokenCount: number;
  maxTokens: number;
  usageFraction: number;
  masked: boolean;
}

export interface AutoDreamState {
  stage: "idle" | "gate" | "started" | "progress" | "completed" | "failed";
  runId?: string;
  gate?: {
    name: string;
    passed: boolean;
    reason?: string;
    value?: string | number | boolean;
  };
  progress?: {
    step: string;
    sessionsFound?: number;
    snippetsLoaded?: number;
    upserts?: number;
    deletes?: number;
  };
  result?: {
    summary?: string;
    upserts: number;
    deletes: number;
    durationMs: number;
  };
  error?: string;
  updatedAt: number;
};

export type PersonalityPulseRow =
  | {
      id: string;
      at: number;
      phase: "completed";
      runId: string;
      summary: string;
      durationMs: number;
      reflectionsPreview?: string[];
      memoryWrites?: number;
      surfaceDecision: "none" | "trace" | "assistant";
      nudgeText?: string;
    }
  | { id: string; at: number; phase: "skipped"; reason: string; detail?: string };

export type PendingApprovalState = {
  callId: string;
  name: string;
  args: Record<string, unknown>;
  approvalTimeoutMs: number;
  receivedAt: number;
};

export interface SSEState {
  messages: MessageEntry[];
  contextSnapshot: ContextSnapshot | null;
  autoDream: AutoDreamState;
  pendingApproval: PendingApprovalState | null;
  pendingAskUser: { prompt: string } | null;
  connected: boolean;
  busy: boolean;
  error: string | null;
  personaName: string;
  uiVerbosity: "normal" | "quiet";
  personaBootstrapPending: boolean;
  personaBootstrapAllowSkip: boolean;
  personaBootstrapProgress: string | null;
  personaBootstrapStage: string | null;
  /** Latest normalized persona HUD theme from server (null = defaults). */
  personaUiTheme: PersonaUiThemeV1 | null;
  /** Header / HUD brand line. */
  personaDisplayLabel: string;
  /** Provider retry events counted during the current send; snapshotted on turn_end. */
  lastTurnProviderRetries: number;
  recoveryPendingCount: number;
  /** Latest context compression event (for footer / summary, not main noise). */
  lastContextCompress: { beforePct: number; afterPct: number; rounds: number } | null;
  /** Ambient personality heartbeat (AGENT_HEARTBEAT) — not a second chat transcript. */
  personalityPulseRows: PersonalityPulseRow[];
  personalityPulseActive: boolean;
  heartbeatUiStrip: boolean;
  heartbeatEnabled: boolean;
}

const ORCH_TOOLS = new Set(["spawn_agent", "wait_for_agents", "cancel_agent", "list_agents"]);

type Action =
  | {
      type: "init_config";
      uiVerbosity: "normal" | "quiet";
      personaBootstrapPending?: boolean;
      personaBootstrapAllowSkip?: boolean;
      personaUiTheme?: PersonaUiThemeV1 | null;
      personaDisplayLabel?: string;
      personalityHeartbeatUiStrip?: boolean;
      personalityHeartbeatEnabled?: boolean;
    }
  | { type: "connected" }
  | { type: "disconnected" }
  | { type: "harness_running"; payload: { startedAt: number } }
  | { type: "user_message"; text: string }
  | { type: "text"; payload: { delta: string; channel?: "user" | "trace" } }
  | { type: "provider_retry"; payload: { attempt: number; maxAttempts: number; message: string; backoffMs: number } }
  | { type: "tool_start"; payload: { callId: string; name: string } }
  | { type: "tool_delta"; payload: { callId: string; argsDelta: string } }
  | {
      type: "tool_approval";
      payload: { callId: string; name: string; args: Record<string, unknown>; approvalTimeoutMs: number };
    }
  | { type: "tool_result"; payload: { callId: string; name: string; args: Record<string, unknown>; ok: boolean; output: string } }
  | { type: "ask_user"; payload: { prompt: string } }
  | { type: "approval_resolved" }
  | { type: "ask_user_resolved" }
  | { type: "turn_end"; payload: { contextSnapshot: ContextSnapshot } }
  | { type: "error"; payload: { message: string } }
  | { type: "subtask_spawned"; payload: { taskId: string; parentTaskId: string; goal: string; depth: number } }
  | { type: "subtask_complete"; payload: { taskId: string; ok: boolean } }
  | { type: "subtask_output"; payload: { taskId: string; delta: string } }
  | { type: "plan_step_done"; payload: { stepIndex: number } }
  | { type: "context_compressed"; payload: { beforeFraction: number; afterFraction: number; roundsCompressed: number } }
  | { type: "persona_changed"; payload: { name: string } }
  | {
      type: "auto_dream";
      payload: {
        stage: "gate" | "started" | "progress" | "completed" | "failed";
        runId: string;
        gate?: {
          name: string;
          passed: boolean;
          reason?: string;
          value?: string | number | boolean;
        };
        progress?: {
          step: string;
          sessionsFound?: number;
          snippetsLoaded?: number;
          upserts?: number;
          deletes?: number;
        };
        result?: {
          summary?: string;
          upserts: number;
          deletes: number;
          durationMs: number;
        };
        error?: string;
      };
    }
  | { type: "persona_bootstrap_progress"; payload: { stage: string; message: string; at: number } }
  | { type: "session_reset" }
  | { type: "heartbeat_scheduled"; payload: { taskId: string; firesAtMs: number; idleMs: number } }
  | { type: "heartbeat_started"; payload: { taskId: string; runId: string } }
  | {
      type: "heartbeat_completed";
      payload: {
        taskId: string;
        runId: string;
        summary: string;
        durationMs: number;
        reflectionsPreview?: string[];
        memoryWrites?: number;
        surfaceDecision: "none" | "trace" | "assistant";
        nudgeText?: string;
      };
    }
  | { type: "heartbeat_skipped"; payload: { taskId: string; reason: string; detail?: string } }
  /**
   * Reconcile UI `busy` with `/api/status` after SSE gaps.
   * `addTraceNote` — only when we had to clear a stuck spinner without `turn_end`.
   */
  | { type: "sync_server_busy"; payload: { busy: boolean; addTraceNote?: boolean } };

function stripTrailingProviderRetry(messages: MessageEntry[]): MessageEntry[] {
  const last = messages.at(-1);
  if (last?.kind === "provider_retry") return messages.slice(0, -1);
  return messages;
}

function reducer(state: SSEState, action: Action): SSEState {
  switch (action.type) {
    case "init_config":
      return {
        ...state,
        uiVerbosity: action.uiVerbosity,
        ...(typeof action.personaBootstrapPending === "boolean"
          ? { personaBootstrapPending: action.personaBootstrapPending }
          : {}),
        ...(typeof action.personaBootstrapAllowSkip === "boolean"
          ? { personaBootstrapAllowSkip: action.personaBootstrapAllowSkip }
          : {}),
        ...(action.personaBootstrapPending === false
          ? { personaBootstrapProgress: null, personaBootstrapStage: null }
          : {}),
        ...(action.personaUiTheme !== undefined ? { personaUiTheme: action.personaUiTheme } : {}),
        ...(typeof action.personaDisplayLabel === "string"
          ? { personaDisplayLabel: action.personaDisplayLabel }
          : {}),
        ...(typeof action.personalityHeartbeatUiStrip === "boolean"
          ? { heartbeatUiStrip: action.personalityHeartbeatUiStrip }
          : {}),
        ...(typeof action.personalityHeartbeatEnabled === "boolean"
          ? { heartbeatEnabled: action.personalityHeartbeatEnabled }
          : {}),
      };

    case "connected":
      return { ...state, connected: true, error: null };

    case "disconnected":
      return {
        ...state,
        connected: false,
        error:
          state.error && state.error !== "Agent error"
            ? state.error
            : "Connection lost. Reconnecting...",
      };

    case "harness_running":
      return { ...state, busy: true };

    case "session_reset":
      return {
        ...state,
        messages: [],
        busy: false,
        error: null,
        contextSnapshot: null,
        autoDream: { stage: "idle", updatedAt: Date.now() },
        pendingApproval: null,
        pendingAskUser: null,
        personaBootstrapPending: state.personaBootstrapPending,
        personaBootstrapProgress: null,
        personaBootstrapStage: null,
        lastTurnProviderRetries: 0,
        recoveryPendingCount: 0,
        lastContextCompress: null,
        personalityPulseRows: [],
        personalityPulseActive: false,
      };

    case "persona_bootstrap_progress":
      return {
        ...state,
        personaBootstrapProgress: action.payload.message,
        personaBootstrapStage: action.payload.stage,
      };

    case "user_message":
      return {
        ...state,
        busy: true,
        error: null,
        personalityPulseActive: false,
        messages: [...state.messages, { kind: "user", text: action.text }],
      };

    case "text": {
      const ch = action.payload.channel ?? "user";
      if (state.uiVerbosity === "quiet" && ch === "trace") {
        return state;
      }
      if (ch === "trace") {
        const lastT = state.messages.at(-1);
        if (lastT?.kind === "trace") {
          return {
            ...state,
            messages: [
              ...state.messages.slice(0, -1),
              { kind: "trace", text: lastT.text + action.payload.delta },
            ],
          };
        }
        return {
          ...state,
          messages: [...state.messages, { kind: "trace", text: action.payload.delta }],
        };
      }
      const baseMessages = stripTrailingProviderRetry(state.messages);
      const last = baseMessages.at(-1);
      if (last?.kind === "assistant" && last.streaming) {
        return {
          ...state,
          messages: [
            ...baseMessages.slice(0, -1),
            { ...last, text: last.text + action.payload.delta },
          ],
        };
      }
      return {
        ...state,
        messages: [
          ...baseMessages,
          { kind: "assistant", text: action.payload.delta, streaming: true },
        ],
      };
    }

    case "provider_retry": {
      const nextRecovery = state.recoveryPendingCount + 1;
      if (state.uiVerbosity === "quiet") {
        return { ...state, recoveryPendingCount: nextRecovery };
      }
      const { attempt, maxAttempts, message, backoffMs } = action.payload;
      const maxLabel = maxAttempts > 0 ? String(maxAttempts) : "∞";
      const line = `⟳ Provider retry ${attempt}/${maxLabel} in ${Math.round(backoffMs / 1000)}s: ${message.slice(0, 220)}`;
      const last = state.messages.at(-1);
      if (last?.kind === "provider_retry") {
        return {
          ...state,
          recoveryPendingCount: nextRecovery,
          messages: [...state.messages.slice(0, -1), { kind: "provider_retry", text: line }],
        };
      }
      return {
        ...state,
        recoveryPendingCount: nextRecovery,
        messages: [...state.messages, { kind: "provider_retry", text: line }],
      };
    }

    case "tool_start": {
      const { name } = action.payload;
      if (name === "think" || name === "plan" || ORCH_TOOLS.has(name)) return state;
      return {
        ...state,
        messages: [
          ...stripTrailingProviderRetry(state.messages),
          {
            kind: "tool_call",
            callId: action.payload.callId,
            name,
            argsJson: "",
            status: "streaming",
            startedAt: Date.now(),
          },
        ],
      };
    }

    case "tool_delta":
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.kind === "tool_call" && m.callId === action.payload.callId
            ? { ...m, argsJson: m.argsJson + action.payload.argsDelta }
            : m
        ),
      };

    case "tool_approval":
      return {
        ...state,
        pendingApproval: {
          callId: action.payload.callId,
          name: action.payload.name,
          args: action.payload.args,
          approvalTimeoutMs: action.payload.approvalTimeoutMs ?? 60_000,
          receivedAt: Date.now(),
        },
        messages: state.messages.map((m) =>
          m.kind === "tool_call" && m.callId === action.payload.callId
            ? { ...m, status: "pending_approval" as const }
            : m
        ),
      };

    case "approval_resolved": {
      const pendingCallId = state.pendingApproval?.callId;
      const messages = pendingCallId
        ? state.messages.map((m) =>
            m.kind === "tool_call" && m.callId === pendingCallId
              ? { ...m, status: "running" as const }
              : m
          )
        : state.messages;
      return { ...state, pendingApproval: null, messages };
    }

    case "tool_result": {
      const { callId, name, args, ok, output } = action.payload;
      if (name === "think" && ok) {
        return {
          ...state,
          messages: [...state.messages, { kind: "think", content: args["content"] as string }],
        };
      }
      if (name === "plan" && ok) {
        const steps = Array.isArray(args["steps"])
          ? (args["steps"] as string[])
          : typeof args["step_index"] === "number"
          ? [`Step ${args["step_index"] as number} marked complete`]
          : [];
        return {
          ...state,
          messages: [...state.messages, { kind: "plan", steps }],
        };
      }
      if (ORCH_TOOLS.has(name)) return state;

      const endedAt = Date.now();
      return {
        ...state,
        messages: state.messages
          .map((m) =>
            m.kind === "tool_call" && m.callId === callId
              ? { ...m, status: ok ? ("done" as const) : ("error" as const), endedAt }
              : m
          )
          .concat([{ kind: "tool_result", callId, output, ok }]),
      };
    }

    case "ask_user":
      return { ...state, pendingAskUser: action.payload };

    case "ask_user_resolved":
      return { ...state, pendingAskUser: null };

    case "turn_end": {
      const msgs = stripTrailingProviderRetry(state.messages).map((m) =>
        m.kind === "assistant" && m.streaming ? { ...m, streaming: false } : m
      );
      return {
        ...state,
        busy: false,
        contextSnapshot: action.payload.contextSnapshot,
        messages: msgs,
        lastTurnProviderRetries: state.recoveryPendingCount,
        recoveryPendingCount: 0,
      };
    }

    case "sync_server_busy": {
      if (action.payload.busy) {
        return state.busy ? state : { ...state, busy: true };
      }
      if (!state.busy) return state;
      const msgs = stripTrailingProviderRetry(state.messages).map((m) =>
        m.kind === "assistant" && m.streaming ? { ...m, streaming: false } : m
      );
      const nextMessages = action.payload.addTraceNote
        ? [
            ...msgs,
            {
              kind: "trace" as const,
              text: "[UI] Server finished; SSE turn_end was delayed or missed — UI unlocked. You can send again.\n",
            },
          ]
        : msgs;
      return {
        ...state,
        busy: false,
        personalityPulseActive: false,
        messages: nextMessages,
        recoveryPendingCount: 0,
      };
    }

    case "error":
      return {
        ...state,
        busy: false,
        personalityPulseActive: false,
        error: action.payload.message,
        messages: stripTrailingProviderRetry(state.messages),
      };

    case "subtask_spawned":
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            kind: "subtask",
            taskId: action.payload.taskId,
            parentTaskId: action.payload.parentTaskId,
            goal: action.payload.goal,
            depth: action.payload.depth,
            status: "running",
            partialOutput: "",
          },
        ],
      };

    case "subtask_output":
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.kind === "subtask" && m.taskId === action.payload.taskId
            ? { ...m, partialOutput: m.partialOutput + action.payload.delta }
            : m
        ),
      };

    case "subtask_complete":
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.kind === "subtask" && m.taskId === action.payload.taskId
            ? {
                ...m,
                status: action.payload.ok ? ("done" as const) : ("error" as const),
              }
            : m
        ),
      };

    case "plan_step_done": {
      const msgs = [...state.messages];
      for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i]!;
        if (m.kind === "plan" && action.payload.stepIndex < m.steps.length) {
          const updatedSteps = m.steps.map((s, j) =>
            j === action.payload.stepIndex && !s.startsWith("✓") ? `✓ ${s}` : s
          );
          msgs[i] = { ...m, steps: updatedSteps };
          break;
        }
      }
      return { ...state, messages: msgs };
    }

    case "context_compressed": {
      const snap = {
        beforePct: Math.round(action.payload.beforeFraction * 100),
        afterPct: Math.round(action.payload.afterFraction * 100),
        rounds: action.payload.roundsCompressed,
      };
      return {
        ...state,
        lastContextCompress: snap,
        messages: [
          ...state.messages,
          {
            kind: "context_compressed",
            beforePct: snap.beforePct,
            afterPct: snap.afterPct,
            rounds: snap.rounds,
          },
        ],
      };
    }

    case "persona_changed":
      return { ...state, personaName: action.payload.name };

    case "heartbeat_scheduled":
      return state;

    case "heartbeat_started":
      return { ...state, personalityPulseActive: true };

    case "heartbeat_completed": {
      const p = action.payload;
      const msgs = [...state.messages];
      if (p.surfaceDecision === "assistant" && p.nudgeText) {
        msgs.push({ kind: "pulse_nudge", text: p.nudgeText, at: Date.now() });
      }
      const row: PersonalityPulseRow = {
        id: p.runId,
        at: Date.now(),
        phase: "completed",
        runId: p.runId,
        summary: p.summary,
        durationMs: p.durationMs,
        reflectionsPreview: p.reflectionsPreview,
        memoryWrites: p.memoryWrites,
        surfaceDecision: p.surfaceDecision,
        nudgeText: p.nudgeText,
      };
      return {
        ...state,
        personalityPulseActive: false,
        personalityPulseRows: [...state.personalityPulseRows, row].slice(-24),
        messages: msgs,
      };
    }

    case "heartbeat_skipped": {
      const row: PersonalityPulseRow = {
        id: `sk-${Date.now()}`,
        at: Date.now(),
        phase: "skipped",
        reason: action.payload.reason,
        ...(action.payload.detail !== undefined ? { detail: action.payload.detail } : {}),
      };
      return {
        ...state,
        personalityPulseActive: false,
        personalityPulseRows: [...state.personalityPulseRows, row].slice(-24),
      };
    }

    case "auto_dream":
      return {
        ...state,
        autoDream: {
          stage: action.payload.stage,
          runId: action.payload.runId,
          gate: action.payload.gate,
          progress: action.payload.progress,
          result: action.payload.result,
          error: action.payload.error,
          updatedAt: Date.now(),
        },
      };
  }
}

/** Same origin as the page so Vite dev (`:5173`) can proxy `/api` → Express (`:3001`). */
export const WEB_SERVER_BASE =
  typeof window !== "undefined" ? "" : "http://localhost:3001";

const SERVER = WEB_SERVER_BASE;

/** Min time after Send before status poll may clear `busy` without `turn_end`. */
const TURN_POST_SEND_GRACE_MS = 8_000;
/** No harness SSE activity for this long + server idle → eligible to unlock. */
const HARNESS_ACTIVITY_IDLE_MS = 22_000;
/** Consecutive `/api/status` idle polls required before forced unlock. */
const STATUS_IDLE_POLLS_REQUIRED = 3;
const STATUS_POLL_INTERVAL_MS = 12_000;

// ─── Retry helpers ────────────────────────────────────────────────────────────

function reconnectDelay(attempt: number): number {
  // 300ms → 600ms → 1.2s → 2.4s → 4.8s → 8s cap, plus small jitter
  return Math.min(300 * 2 ** attempt, 8_000) + Math.random() * 150;
}

function postDelay(attempt: number): number {
  return Math.min(500 * 2 ** attempt, 8_000) + Math.random() * 200;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxAttempts = 8
): Promise<{ ok: boolean; status: number; body: unknown }> {
  let lastErr = "";
  let lastStatus = 0;
  for (let i = 0; i < maxAttempts; i++) {
    if (i > 0) await sleep(postDelay(i - 1));
    try {
      const r = await fetch(url, init);
      const body = await r.json().catch(() => ({}));
      lastStatus = r.status;
      // 409 = agent busy; treat as success — first attempt got through
      if (r.status === 409) return { ok: true, status: 409, body };
      // 4xx client error — don't retry
      if (r.status >= 400 && r.status < 500) return { ok: false, status: r.status, body };
      if (r.ok) return { ok: true, status: r.status, body };
      lastErr = (body as { error?: string }).error ?? `HTTP ${r.status}`;
      // 5xx — retry; cap attempts lower than network blips
      if (r.status >= 500 && i >= Math.min(4, maxAttempts) - 1) {
        return { ok: false, status: r.status, body: { error: lastErr } };
      }
    } catch (e) {
      lastErr = e instanceof Error ? e.message : "Network error";
      lastStatus = 0;
    }
  }
  return { ok: false, status: lastStatus, body: { error: lastErr } };
}

interface HarnessStatusResponse {
  busy?: boolean;
  startedAt?: number | null;
  lastTurnEndedAt?: number | null;
}

async function fetchHarnessStatus(): Promise<HarnessStatusResponse | null> {
  try {
    const r = await fetch(`${SERVER}/api/status`);
    if (!r.ok) return null;
    return (await r.json()) as HarnessStatusResponse;
  } catch {
    return null;
  }
}

// ─── React hook ───────────────────────────────────────────────────────────────

export interface OutgoingChatMessage {
  text: string;
  attachments?: ImageAttachment[];
}

export interface SendMessageResult {
  ok: boolean;
  error?: string;
}

function createInitialSSEState(): SSEState {
  const chrome = readPersonaChromeFromSession();
  return {
    messages: [],
    contextSnapshot: null,
    autoDream: { stage: "idle", updatedAt: Date.now() },
    pendingApproval: null,
    pendingAskUser: null,
    connected: false,
    busy: false,
    error: null,
    personaName: "Liminal",
    uiVerbosity: "normal",
    personaBootstrapPending: false,
    personaBootstrapAllowSkip: true,
    personaBootstrapProgress: null,
    personaBootstrapStage: null,
    personaUiTheme: chrome?.personaUiTheme ?? null,
    personaDisplayLabel: chrome?.personaDisplayLabel ?? "LIMINAL",
    lastTurnProviderRetries: 0,
    recoveryPendingCount: 0,
    lastContextCompress: null,
    personalityPulseRows: [],
    personalityPulseActive: false,
    heartbeatUiStrip: false,
    heartbeatEnabled: false,
  };
}

export function useSSE() {
  const [state, dispatch] = useReducer(reducer, undefined, createInitialSSEState);

  // Text-batching refs — stable across renders, safe to use inside EventSource callbacks.
  const queuedText = useRef("");
  const queuedTrace = useRef("");
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Reconnect state — managed outside React so it survives re-renders without effect re-runs.
  const lastEventId = useRef<string | undefined>(undefined);
  const reconnectAttempt = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const cancelledRef = useRef(false);
  const fetchConfigRef = useRef<() => void>(() => {});
  /** True from `user_message` until `turn_end` / `error` / forced status unlock. */
  const expectTurnEndRef = useRef(false);
  const turnSentAtMsRef = useRef(0);
  const lastHarnessActivityMsRef = useRef(0);
  const statusIdlePollStreakRef = useRef(0);
  const lastSeenServerTurnEndedAtRef = useRef<number | null>(null);

  const markHarnessActivity = useCallback(() => {
    lastHarnessActivityMsRef.current = Date.now();
    statusIdlePollStreakRef.current = 0;
  }, []);

  const reconcileBusyFromStatus = useCallback(
    async (opts?: { forceIfServerBusy?: boolean }) => {
      const st = await fetchHarnessStatus();
      if (!st) return;
      if (st.busy) {
        statusIdlePollStreakRef.current = 0;
        if (opts?.forceIfServerBusy || expectTurnEndRef.current) {
          dispatch({ type: "sync_server_busy", payload: { busy: true } });
        }
        return;
      }
      const endedAt = st.lastTurnEndedAt ?? null;
      if (
        endedAt != null &&
        endedAt > 0 &&
        (lastSeenServerTurnEndedAtRef.current == null || endedAt > lastSeenServerTurnEndedAtRef.current)
      ) {
        lastSeenServerTurnEndedAtRef.current = endedAt;
        if (expectTurnEndRef.current) {
          expectTurnEndRef.current = false;
          dispatch({
            type: "sync_server_busy",
            payload: { busy: false, addTraceNote: true },
          });
        }
        return;
      }
      if (!expectTurnEndRef.current) return;
      const now = Date.now();
      if (now - turnSentAtMsRef.current < TURN_POST_SEND_GRACE_MS) return;
      if (now - lastHarnessActivityMsRef.current < HARNESS_ACTIVITY_IDLE_MS) return;
      statusIdlePollStreakRef.current += 1;
      if (statusIdlePollStreakRef.current < STATUS_IDLE_POLLS_REQUIRED) return;
      expectTurnEndRef.current = false;
      statusIdlePollStreakRef.current = 0;
      dispatch({
        type: "sync_server_busy",
        payload: { busy: false, addTraceNote: true },
      });
    },
    []
  );

  useEffect(() => {
    if (!state.busy) return;
    void reconcileBusyFromStatus();
    const id = setInterval(() => void reconcileBusyFromStatus(), STATUS_POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [state.busy, reconcileBusyFromStatus]);

  useEffect(() => {
    cancelledRef.current = false;

    const flush = () => {
      flushTimer.current = null;
      if (queuedText.current) {
        dispatch({ type: "text", payload: { delta: queuedText.current, channel: "user" } });
        queuedText.current = "";
      }
      if (queuedTrace.current) {
        dispatch({ type: "text", payload: { delta: queuedTrace.current, channel: "trace" } });
        queuedTrace.current = "";
      }
    };
    const queueFlush = () => {
      if (!flushTimer.current) flushTimer.current = setTimeout(flush, 40);
    };
    const flushNow = () => {
      if (flushTimer.current) { clearTimeout(flushTimer.current); flushTimer.current = null; }
      flush();
    };

    const fetchAndApplyConfig = () => {
      fetch(`${SERVER}/api/config`)
        .then((r) => (r.ok ? r.json() : null))
        .then(
          (
            cfg: {
              uiVerbosity?: string;
              personaBootstrapPending?: boolean;
              personaBootstrapAllowSkip?: boolean;
              personaUiTheme?: PersonaUiThemeV1 | null;
              personaDisplayLabel?: string;
              personalityHeartbeatUiStrip?: boolean;
              personalityHeartbeatEnabled?: boolean;
            } | null
          ) => {
            if (!cancelledRef.current && cfg) {
              const personaDisplayLabel =
                typeof cfg.personaDisplayLabel === "string" && cfg.personaDisplayLabel.trim()
                  ? cfg.personaDisplayLabel.trim()
                  : "LIMINAL";
              const personaUiTheme = cfg.personaUiTheme ?? null;
              dispatch({
                type: "init_config",
                uiVerbosity: cfg.uiVerbosity === "quiet" ? "quiet" : "normal",
                personaBootstrapPending: cfg.personaBootstrapPending,
                personaBootstrapAllowSkip: cfg.personaBootstrapAllowSkip,
                personaUiTheme,
                personaDisplayLabel,
                personalityHeartbeatUiStrip: cfg.personalityHeartbeatUiStrip,
                personalityHeartbeatEnabled: cfg.personalityHeartbeatEnabled,
              });
              writePersonaChromeToSession(personaUiTheme, personaDisplayLabel);
            }
          }
        )
        .catch(() => {
          /* keep defaults */
        });
    };

    fetchConfigRef.current = fetchAndApplyConfig;

    fetchAndApplyConfig();

    function connect() {
      if (cancelledRef.current) return;

      // Build URL — pass lastEventId as query param so server can replay missed events.
      const eid = lastEventId.current;
      const url = eid
        ? `${SERVER}/api/stream?lastEventId=${encodeURIComponent(eid)}`
        : `${SERVER}/api/stream`;

      const es = new EventSource(url);
      esRef.current = es;

      es.addEventListener("connected", () => {
        // Clear any pending CONNECTING-state takeover timer — we made it.
        if (reconnectTimer.current) { clearTimeout(reconnectTimer.current); reconnectTimer.current = null; }
        reconnectAttempt.current = 0;
        dispatch({ type: "connected" });
        void reconcileBusyFromStatus({ forceIfServerBusy: true });
        fetchAndApplyConfig();
      });

      // Grab the event ID from every event so we can resume after reconnect.
      const trackId = (e: MessageEvent) => {
        if (e.lastEventId) lastEventId.current = e.lastEventId;
      };

      es.addEventListener("text", (e: MessageEvent) => {
        trackId(e);
        const payload = JSON.parse(e.data) as { delta: string; channel?: "user" | "trace" };
        if ((payload.channel ?? "user") !== "trace") markHarnessActivity();
        const cleaned = sanitizeDeltaText(payload.delta);
        if ((payload.channel ?? "user") === "trace") queuedTrace.current += cleaned;
        else queuedText.current += cleaned;
        queueFlush();
      });

      es.addEventListener("provider_retry", (e: MessageEvent) => {
        trackId(e);
        dispatch({ type: "provider_retry", payload: JSON.parse(e.data) });
      });
      es.addEventListener("tool_start", (e: MessageEvent) => {
        trackId(e); flushNow();
        dispatch({ type: "tool_start", payload: JSON.parse(e.data) });
      });
      es.addEventListener("tool_delta", (e: MessageEvent) => {
        trackId(e); flushNow();
        dispatch({ type: "tool_delta", payload: JSON.parse(e.data) });
      });
      es.addEventListener("tool_approval", (e: MessageEvent) => {
        trackId(e); flushNow();
        dispatch({ type: "tool_approval", payload: JSON.parse(e.data) });
      });
      es.addEventListener("tool_result", (e: MessageEvent) => {
        trackId(e);
        markHarnessActivity();
        flushNow();
        dispatch({ type: "tool_result", payload: JSON.parse(e.data) });
      });
      es.addEventListener("ask_user", (e: MessageEvent) => {
        trackId(e); flushNow();
        dispatch({ type: "ask_user", payload: JSON.parse(e.data) });
      });
      es.addEventListener("turn_end", (e: MessageEvent) => {
        trackId(e);
        expectTurnEndRef.current = false;
        statusIdlePollStreakRef.current = 0;
        void fetchHarnessStatus().then((st) => {
          if (st?.lastTurnEndedAt != null) {
            lastSeenServerTurnEndedAtRef.current = st.lastTurnEndedAt;
          }
        });
        flushNow();
        dispatch({ type: "turn_end", payload: JSON.parse(e.data) });
      });
      es.addEventListener("subtask_spawned", (e: MessageEvent) => {
        trackId(e); flushNow();
        dispatch({ type: "subtask_spawned", payload: JSON.parse(e.data) });
      });
      es.addEventListener("subtask_complete", (e: MessageEvent) => {
        trackId(e); flushNow();
        dispatch({ type: "subtask_complete", payload: JSON.parse(e.data) });
      });
      es.addEventListener("subtask_output", (e: MessageEvent) => {
        trackId(e); flushNow();
        dispatch({ type: "subtask_output", payload: JSON.parse(e.data) });
      });
      es.addEventListener("plan_step_done", (e: MessageEvent) => {
        trackId(e); flushNow();
        dispatch({ type: "plan_step_done", payload: JSON.parse(e.data) });
      });
      es.addEventListener("context_compressed", (e: MessageEvent) => {
        trackId(e); flushNow();
        dispatch({ type: "context_compressed", payload: JSON.parse(e.data) });
      });
      es.addEventListener("persona_changed", (e: MessageEvent) => {
        trackId(e); flushNow();
        dispatch({ type: "persona_changed", payload: JSON.parse(e.data) });
        fetchConfigRef.current();
      });
      es.addEventListener("auto_dream", (e: MessageEvent) => {
        trackId(e);
        dispatch({ type: "auto_dream", payload: JSON.parse(e.data) });
      });
      es.addEventListener("heartbeat_scheduled", (e: MessageEvent) => {
        trackId(e);
        dispatch({ type: "heartbeat_scheduled", payload: JSON.parse(e.data) });
      });
      es.addEventListener("heartbeat_started", (e: MessageEvent) => {
        trackId(e);
        dispatch({ type: "heartbeat_started", payload: JSON.parse(e.data) });
      });
      es.addEventListener("heartbeat_completed", (e: MessageEvent) => {
        trackId(e);
        dispatch({ type: "heartbeat_completed", payload: JSON.parse(e.data) });
      });
      es.addEventListener("heartbeat_skipped", (e: MessageEvent) => {
        trackId(e);
        dispatch({ type: "heartbeat_skipped", payload: JSON.parse(e.data) });
      });
      es.addEventListener("persona_bootstrap_progress", (e: MessageEvent) => {
        trackId(e);
        dispatch({ type: "persona_bootstrap_progress", payload: JSON.parse(e.data) });
      });
      es.addEventListener("error", (e: Event) => {
        const me = e as MessageEvent;
        // Server-sent `event: error` carries JSON in `data`. Native connection errors
        // use the same listener name but have no `data` — do not treat as harness failure.
        if (typeof me.data !== "string" || !me.data.trim()) return;
        trackId(me);
        flushNow();
        expectTurnEndRef.current = false;
        statusIdlePollStreakRef.current = 0;
        try {
          dispatch({ type: "error", payload: JSON.parse(me.data) });
        } catch {
          dispatch({ type: "error", payload: { message: me.data } });
        }
      });
      es.addEventListener("runtime_pref_detected", (e: MessageEvent) => {
        trackId(e);
        const p = JSON.parse(e.data) as { summary: string; risky: boolean };
        dispatch({ type: "text", payload: { channel: "trace", delta: `\n[prefs] detected risky=${p.risky ? "yes" : "no"} ${p.summary}\n` } });
      });
      es.addEventListener("runtime_pref_changed", (e: MessageEvent) => {
        trackId(e);
        const p = JSON.parse(e.data) as {
          summary: string;
          persisted: boolean;
          personaControls?: {
            humorPercent?: number;
            formality?: string;
            confidence?: number;
            verbosity?: string;
            personaStrength?: number;
          };
        };
        const controls = p.personaControls
          ? Object.entries(p.personaControls)
              .filter(([, v]) => v !== undefined)
              .map(([k, v]) => `${k}=${String(v)}`)
              .join(", ")
          : "";
        const controlsSuffix = controls ? ` controls=[${controls}]` : "";
        dispatch({
          type: "text",
          payload: {
            channel: "trace",
            delta: `\n[prefs] changed persisted=${p.persisted ? "yes" : "no"} ${p.summary}${controlsSuffix}\n`,
          },
        });
      });
      es.addEventListener("runtime_pref_persisted", (e: MessageEvent) => {
        trackId(e);
        const p = JSON.parse(e.data) as { path: string };
        dispatch({ type: "text", payload: { channel: "trace", delta: `\n[prefs] persisted path=${p.path}\n` } });
      });
      es.addEventListener("runtime_pref_rejected", (e: MessageEvent) => {
        trackId(e);
        const p = JSON.parse(e.data) as { summary: string; reason: string };
        dispatch({ type: "text", payload: { channel: "trace", delta: `\n[prefs] rejected ${p.summary} (${p.reason})\n` } });
      });

      // harness_running — emitted every 5 s while agent is mid-turn.
      // Lands in SSE history so reconnecting clients know work is ongoing.
      es.addEventListener("harness_running", (e: MessageEvent) => {
        trackId(e);
        markHarnessActivity();
        dispatch({ type: "harness_running", payload: JSON.parse(e.data) });
      });

      // Ack-only events — no UI effect needed.
      ["ask_user_answered", "approval_decision", "tool_timing", "vault_activity",
        "runtime_heartbeat", "drift_detected", "execution_state", "contract_transition",
        "contract_violation", "recovery_action"].forEach((evt) => {
        es.addEventListener(evt, trackId as EventListener);
      });

      // onerror fires for transient errors (CONNECTING) and fatal closes (CLOSED).
      es.onerror = () => {
        if (cancelledRef.current) return;

        if (es.readyState === EventSource.CONNECTING) {
          // Native EventSource will retry on its own schedule, but ERR_CONNECTION_RESET
          // can stall it in CONNECTING indefinitely without ever reaching CLOSED.
          // Schedule a 2s takeover: if the connection still isn't OPEN by then, we
          // close the native ES and drive the reconnect ourselves with backoff.
          dispatch({ type: "disconnected" });
          if (!reconnectTimer.current) {
            reconnectTimer.current = setTimeout(() => {
              reconnectTimer.current = null;
              if (cancelledRef.current) return;
              if (esRef.current?.readyState === EventSource.OPEN) return; // recovered on its own
              esRef.current?.close();
              esRef.current = null;
              const delay = reconnectDelay(reconnectAttempt.current);
              reconnectAttempt.current = Math.min(reconnectAttempt.current + 1, 6);
              reconnectTimer.current = setTimeout(connect, delay);
            }, 2_000);
          }
          return;
        }

        // CLOSED — browser gave up entirely. Take over immediately.
        if (reconnectTimer.current) { clearTimeout(reconnectTimer.current); reconnectTimer.current = null; }
        es.close();
        esRef.current = null;
        dispatch({ type: "disconnected" });
        const delay = reconnectDelay(reconnectAttempt.current);
        reconnectAttempt.current = Math.min(reconnectAttempt.current + 1, 6);
        reconnectTimer.current = setTimeout(connect, delay);
      };
    }

    connect();

    // When the tab becomes visible after being hidden, browsers throttle/freeze
    // timers — reconnect immediately if the connection is stale.
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible" || cancelledRef.current) return;
      if (!esRef.current || esRef.current.readyState !== EventSource.OPEN) {
        if (reconnectTimer.current) { clearTimeout(reconnectTimer.current); reconnectTimer.current = null; }
        esRef.current?.close();
        esRef.current = null;
        reconnectAttempt.current = 0; // reset backoff — user just came back
        connect();
      } else {
        void reconcileBusyFromStatus();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelledRef.current = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (flushTimer.current) clearTimeout(flushTimer.current);
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      esRef.current?.close();
      esRef.current = null;
    };
  }, [markHarnessActivity, reconcileBusyFromStatus]);

  const sendMessage = useCallback(async (payload: OutgoingChatMessage): Promise<SendMessageResult> => {
    const text = payload.text.trim();
    const attachmentCount = payload.attachments?.length ?? 0;
    const renderedUserMessage =
      attachmentCount > 0 ? `${text || "(no text)"}\n[attached images: ${attachmentCount}]` : text;
    const now = Date.now();
    turnSentAtMsRef.current = now;
    lastHarnessActivityMsRef.current = now;
    expectTurnEndRef.current = true;
    statusIdlePollStreakRef.current = 0;
    dispatch({ type: "user_message", text: renderedUserMessage });

    const result = await fetchWithRetry(
      `${SERVER}/api/message`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, attachments: payload.attachments ?? [] }),
      },
      8
    );

    if (!result.ok) {
      expectTurnEndRef.current = false;
      const message = (result.body as { error?: string }).error ?? `Send failed (${result.status})`;
      dispatch({ type: "error", payload: { message } });
      return { ok: false, error: message };
    }
    return { ok: true };
  }, []);

  const sendApproval = useCallback(async (callId: string, decision: unknown) => {
    const result = await fetchWithRetry(
      `${SERVER}/api/approve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callId, decision }),
      },
      6
    );
    if (result.ok) {
      dispatch({ type: "approval_resolved" });
    } else {
      const message = (result.body as { error?: string }).error ?? `Approval failed (${result.status})`;
      dispatch({ type: "error", payload: { message } });
    }
  }, []);

  const sendAnswer = useCallback(async (answer: string) => {
    const result = await fetchWithRetry(
      `${SERVER}/api/answer`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer }),
      },
      6
    );
    if (result.ok) {
      dispatch({ type: "ask_user_resolved" });
    } else {
      const message = (result.body as { error?: string }).error ?? `Answer failed (${result.status})`;
      dispatch({ type: "error", payload: { message } });
    }
  }, []);

  const sendClearSession = useCallback(async () => {
    const result = await fetchWithRetry(
      `${SERVER}/api/session/reset`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "soft" }),
      },
      4
    );
    if (result.ok) {
      expectTurnEndRef.current = false;
      statusIdlePollStreakRef.current = 0;
      dispatch({ type: "session_reset" });
      fetchConfigRef.current();
      return;
    }
    const msg = (result.body as { error?: string }).error ?? `Session reset failed (${result.status})`;
    dispatch({ type: "error", payload: { message: msg } });
  }, []);

  const sendPersonaBootstrap = useCallback(
    async (input: string, options?: { skip?: boolean }): Promise<SendMessageResult> => {
      const result = await fetchWithRetry(
        `${SERVER}/api/persona/bootstrap`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input, skip: Boolean(options?.skip) }),
        },
        6
      );
      if (!result.ok) {
        const body = result.body as { error?: string; detail?: string };
        const raw = body.error ?? `Bootstrap failed (${result.status})`;
        const detail = typeof body.detail === "string" && body.detail !== raw ? ` (${body.detail})` : "";
        const message =
          result.status === 409
            ? "Persona setup is still initializing. Please retry in a moment."
            : `${raw}${detail}`;
        dispatch({ type: "error", payload: { message } });
        return { ok: false, error: message };
      }
      dispatch({
        type: "init_config",
        uiVerbosity: state.uiVerbosity,
        personaBootstrapPending: false,
      });
      fetchConfigRef.current();
      return { ok: true };
    },
    [state.uiVerbosity]
  );

  return { state, sendMessage, sendApproval, sendAnswer, sendClearSession, sendPersonaBootstrap };
}
