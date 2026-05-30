import { useEffect, useReducer, useCallback, useRef, type MutableRefObject } from "react";
import type { PersonaUiThemeV2 } from "@liminal/core/persona-ui-theme";
import type { PersonaArtifactPreview } from "@liminal/core/persona-bootstrap-progress";
import {
  extractStreamingWritePreview,
  isStreamingWriteTool,
} from "@liminal/core/streaming-write-preview";
import type { ImageAttachment } from "./imageAttachments.js";
import { readPersonaChromeFromSession, writePersonaChromeToSession } from "./personaChromeSessionCache.js";

/** Set only after a successful auto-greet reset (survives remount within the tab). */
const SS_AUTO_GREET_DONE = "liminal:auto_greet_done_v1";
const SS_SSE_LAST_EVENT_ID = "liminal:sse_last_event_id_v1";
/** Legacy key from an earlier fix attempt — clear so it cannot block greet. */
const SS_TAB_SESSION_INIT_LEGACY = "liminal:tab_session_init_v1";

function readStoredLastEventId(): string | undefined {
  try {
    const v = sessionStorage.getItem(SS_SSE_LAST_EVENT_ID);
    return v && /^\d+$/.test(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

function writeStoredLastEventId(id: string): void {
  try {
    sessionStorage.setItem(SS_SSE_LAST_EVENT_ID, id);
  } catch {
    /* private mode / quota */
  }
}

function clearStoredLastEventId(): void {
  try {
    sessionStorage.removeItem(SS_SSE_LAST_EVENT_ID);
  } catch {
    /* ignore */
  }
}

function isAutoGreetDone(): boolean {
  try {
    sessionStorage.removeItem(SS_TAB_SESSION_INIT_LEGACY);
    return sessionStorage.getItem(SS_AUTO_GREET_DONE) === "1";
  } catch {
    return false;
  }
}

function markAutoGreetDone(): void {
  try {
    sessionStorage.setItem(SS_AUTO_GREET_DONE, "1");
  } catch {
    /* ignore */
  }
}

function clearAutoGreetDone(): void {
  try {
    sessionStorage.removeItem(SS_AUTO_GREET_DONE);
  } catch {
    /* ignore */
  }
}

/** Prevents duplicate auto-greet under React Strict Mode (in-memory only; resets on full reload). */
let autoGreetAttemptedThisPageLoad = false;

function sanitizeDeltaText(text: string): string {
  return text
    .replace(/�/g, "")
    .replace(/\s*⚙\s*/g, " ")
    .replace(/\r/g, "");
}

function finalizeStreamingModelReasoning(messages: MessageEntry[]): MessageEntry[] {
  return messages.map((m) =>
    m.kind === "model_reasoning" && m.streaming ? { ...m, streaming: false } : m
  );
}

function finalizeStreamingReasoningEntries(messages: MessageEntry[]): MessageEntry[] {
  return messages.map((m) => {
    if (m.kind === "think" && m.streaming) {
      return {
        ...m,
        streaming: false,
        content: m.content.trim() ? m.content : "(reasoning interrupted before completion)",
      };
    }
    if (m.kind === "plan" && m.streaming) {
      return { ...m, streaming: false };
    }
    if (m.kind === "model_reasoning" && m.streaming) {
      return { ...m, streaming: false };
    }
    return m;
  });
}

function updateStreamingThinkFromArgs(
  messages: MessageEntry[],
  callId: string,
  argsJson: string
): MessageEntry[] {
  return messages.map((m) => {
    if (m.kind !== "think" || m.callId !== callId || !m.streaming) return m;
    const preview = extractStreamingWritePreview("think", argsJson);
    return { ...m, argsJson, content: preview?.content ?? m.content };
  });
}

function updateStreamingReasonFromArgs(
  messages: MessageEntry[],
  callId: string,
  argsJson: string
): MessageEntry[] {
  return messages.map((m) => {
    if (m.kind !== "reason" || m.callId !== callId || !m.streaming) return m;
    const preview = extractStreamingWritePreview("reason", argsJson);
    return { ...m, argsJson, inference: preview?.content ?? m.inference };
  });
}

function promoteWriteToolCallIfArgsComplete(
  entry: Extract<MessageEntry, { kind: "tool_call" }>,
  argsJson: string
): Extract<MessageEntry, { kind: "tool_call" }> {
  if (entry.status !== "streaming" || !isStreamingWriteTool(entry.name)) {
    return { ...entry, argsJson };
  }
  const preview = extractStreamingWritePreview(entry.name, argsJson);
  if (preview && !preview.incomplete) {
    return { ...entry, argsJson, status: "running" };
  }
  return { ...entry, argsJson };
}

function updateStreamingPlanFromArgs(
  messages: MessageEntry[],
  callId: string,
  argsJson: string
): MessageEntry[] {
  return messages.map((m) => {
    if (m.kind !== "plan" || m.callId !== callId || !m.streaming) return m;
    const preview = extractStreamingWritePreview("plan", argsJson);
    return {
      ...m,
      argsJson,
      previewText: preview?.rawArgsTail ?? preview?.content ?? m.previewText ?? "",
    };
  });
}

/** Close tool cards that never received tool_result (stream timeout, error, forced idle). */
function finalizeOrphanToolCalls(messages: MessageEntry[]): MessageEntry[] {
  const withReasoning = finalizeStreamingReasoningEntries(messages);
  const now = Date.now();
  const orphans = withReasoning.filter(
    (m): m is Extract<MessageEntry, { kind: "tool_call" }> =>
      m.kind === "tool_call" &&
      m.endedAt == null &&
      (m.status === "streaming" || m.status === "running" || m.status === "pending_approval")
  );
  if (orphans.length === 0) return withReasoning;

  const orphanIds = new Set(orphans.map((m) => m.callId));
  const updated = withReasoning.map((m) =>
    m.kind === "tool_call" && orphanIds.has(m.callId)
      ? { ...m, status: "error" as const, endedAt: now }
      : m
  );
  const results: MessageEntry[] = orphans.map((m) => ({
    kind: "tool_result" as const,
    callId: m.callId,
    ok: false,
    output:
      m.status === "pending_approval"
        ? "Turn ended before approval (harness stopped or connection lost)."
        : m.status === "streaming"
        ? "Turn ended while tool arguments were still streaming (provider stall or timeout)."
        : "Turn ended before the tool finished executing.",
  }));
  return [...updated, ...results];
}

/** Prevents React from crashing if the server emits malformed SSE JSON. */
function parseEventData(e: MessageEvent): unknown {
  const raw = (e as MessageEvent<string>).data;
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch (err) {
    console.warn("[useSSE] SSE JSON.parse failed:", err);
    return undefined;
  }
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
  | {
      kind: "think";
      callId?: string;
      streaming?: boolean;
      argsJson?: string;
      content: string;
      tool_families?: string[];
      scope?: string;
      unknowns?: string[];
      clarification_needed?: boolean;
      clarification_question?: string;
      self_check?: number;
    }
  | {
      kind: "reason";
      callId?: string;
      streaming?: boolean;
      argsJson?: string;
      inference: string;
      confidence?: "low" | "medium" | "high";
      next_action?: string;
    }
  | {
      kind: "plan";
      steps: string[];
      callId?: string;
      streaming?: boolean;
      argsJson?: string;
      previewText?: string;
    }
  | { kind: "model_reasoning"; text: string; streaming: boolean }
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
  | { kind: "context_compressed"; beforePct: number; afterPct: number; rounds: number }
  | {
      kind: "turn_header";
      intentClass: string;
      outcomeScore: number;
      toolCount: number;
      durationMs: number;
      keyTools: string[];
      terminationReason: string;
    }
  | {
      kind: "working_state";
      goal?: string;
      driftScore?: number;
      subgoalsPreview?: string;
      executionPreview?: string;
    };

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

/** EventSource/stream layer (distinct from REST API reachability). */
export type SseTransport = "open" | "reconnecting" | "offline";

/** Lightweight `/api/status` probe (no SSE). */
export type ApiReachable = "unknown" | "ok" | "down";

export interface SSEState {
  messages: MessageEntry[];
  contextSnapshot: ContextSnapshot | null;
  autoDream: AutoDreamState;
  pendingApproval: PendingApprovalState | null;
  pendingAskUser: { prompt: string } | null;
  /** True when the SSE handshake received `connected` and the socket is usable. */
  connected: boolean;
  /** Stream quality: reconnecting/offline ≠ API down (see `apiReachable`). */
  sseTransport: SseTransport;
  sseTransportDetail: string;
  /** Becomes true after the first SSE `connected` handshake (avoids BOOT→DEGRADED flash). */
  sseHasOpenedOnce: boolean;
  apiReachable: ApiReachable;
  busy: boolean;
  error: string | null;
  personaName: string;
  uiVerbosity: "normal" | "quiet";
  personaBootstrapPending: boolean;
  personaBootstrapAllowSkip: boolean;
  personaBootstrapProgress: string | null;
  personaBootstrapStage: string | null;
  personaBootstrapArtifacts: PersonaArtifactPreview[] | null;
  /** Latest normalized persona HUD theme from server (null = defaults). */
  personaUiTheme: PersonaUiThemeV2 | null;
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
  /** Play a brief tone when dictation sends (AGENT_DICTATION_AUDIO_CUE). */
  dictationAudioCue: boolean;
  /** Jarvis-style spoken channel (AGENT_TTS_ENABLED). */
  ttsEnabled: boolean;
}

const ORCH_TOOLS = new Set(["spawn_agent", "wait_for_agents", "cancel_agent", "list_agents"]);

type Action =
  | {
      type: "init_config";
      uiVerbosity: "normal" | "quiet";
      personaBootstrapPending?: boolean;
      personaBootstrapAllowSkip?: boolean;
      personaUiTheme?: PersonaUiThemeV2 | null;
      personaDisplayLabel?: string;
      personalityHeartbeatUiStrip?: boolean;
      personalityHeartbeatEnabled?: boolean;
      dictationAudioCue?: boolean;
      ttsEnabled?: boolean;
    }
  | { type: "connected" }
  /** Transport lost mid-session; preserves agent `error` unless API is unreachable. */
  | {
      type: "sse_reconnecting";
      payload: {
        detail: string;
        attempt: number;
        /** From `/api/status` — adjusts copy (“busy while SSE down”). */
        serverBusy?: boolean;
      };
    }
  /** Result probing `/api/status` after SSE interruption. */
  | { type: "api_probe_result"; payload: { apiReachable: "ok" | "down"; detail?: string } }
  | { type: "harness_running"; payload: { startedAt: number } }
  | { type: "user_message"; text: string }
  | { type: "remove_last_user_message" }
  | { type: "text"; payload: { delta: string; channel?: "user" | "trace" | "reasoning" } }
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
  | { type: "turn_end"; payload: { contextSnapshot: ContextSnapshot; harnessMetrics?: Record<string, unknown> } }
  | {
      type: "turn_summary";
      payload: {
        intentClass: string;
        outcomeScore: number;
        toolCount: number;
        durationMs: number;
        keyTools: string[];
        terminationReason: string;
      };
    }
  | { type: "tool_timing"; payload: { callId: string; durationMs: number } }
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
  | {
      type: "persona_bootstrap_progress";
      payload: {
        stage: string;
        message: string;
        at: number;
        artifacts?: PersonaArtifactPreview[];
      };
    }
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
          ? {
              personaBootstrapProgress: null,
              personaBootstrapStage: null,
              personaBootstrapArtifacts: null,
            }
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
        ...(typeof action.dictationAudioCue === "boolean"
          ? { dictationAudioCue: action.dictationAudioCue }
          : {}),
        ...(typeof action.ttsEnabled === "boolean" ? { ttsEnabled: action.ttsEnabled } : {}),
      };

    case "connected":
      return {
        ...state,
        connected: true,
        sseTransport: "open",
        sseTransportDetail: "",
        apiReachable: "ok",
        sseHasOpenedOnce: true,
        error: null,
      };

    case "sse_reconnecting": {
      const { detail, attempt, serverBusy } = action.payload;
      const busyFrag =
        serverBusy === true ? " Harness busy — live events may pause until SSE recovers." : "";
      const suffix = attempt > 0 ? ` (attempt ${attempt})` : "";
      const fullDetail = `${detail}${suffix}${busyFrag}`.trim();
      return {
        ...state,
        connected: false,
        sseTransport: "reconnecting",
        sseTransportDetail: fullDetail,
      };
    }

    case "api_probe_result": {
      const wasDown = state.apiReachable === "down";
      if (action.payload.apiReachable === "down") {
        const d =
          typeof action.payload.detail === "string" && action.payload.detail.trim()
            ? action.payload.detail.trim()
            : "Cannot reach API (check :3001 / proxy / vite dev proxy).";
        return {
          ...state,
          apiReachable: "down",
          connected: false,
          sseTransport: "offline",
          sseTransportDetail: d,
          error: d,
        };
      }
      return {
        ...state,
        apiReachable: "ok",
        ...(wasDown ? { error: null } : {}),
      };
    }

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
        personaBootstrapArtifacts: null,
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
        personaBootstrapArtifacts: action.payload.artifacts ?? state.personaBootstrapArtifacts,
      };

    case "user_message":
      return {
        ...state,
        busy: true,
        error: null,
        personalityPulseActive: false,
        messages: [...state.messages, { kind: "user", text: action.text }],
      };

    case "remove_last_user_message": {
      const msgs = [...state.messages];
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i]?.kind === "user") {
          msgs.splice(i, 1);
          break;
        }
      }
      return { ...state, messages: msgs, busy: false };
    }

    case "text": {
      const ch = action.payload.channel ?? "user";
      if (state.uiVerbosity === "quiet" && ch === "trace") {
        return state;
      }
      if (ch === "reasoning") {
        let baseMessages = stripTrailingProviderRetry(state.messages);
        if (/reasoning budget restart/i.test(action.payload.delta)) {
          baseMessages = finalizeStreamingModelReasoning(baseMessages);
        }
        const last = baseMessages.at(-1);
        if (last?.kind === "model_reasoning" && last.streaming) {
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
            { kind: "model_reasoning", text: action.payload.delta, streaming: true },
          ],
        };
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
      let baseMessages = finalizeStreamingModelReasoning(
        stripTrailingProviderRetry(state.messages)
      );
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
      const baseMessages = stripTrailingProviderRetry(state.messages);
      if (state.uiVerbosity === "quiet") {
        return { ...state, recoveryPendingCount: nextRecovery, messages: baseMessages };
      }
      const { attempt, maxAttempts, message, backoffMs } = action.payload;
      const maxLabel = maxAttempts > 0 ? String(maxAttempts) : "∞";
      const line = `⟳ Provider retry ${attempt}/${maxLabel} in ${Math.round(backoffMs / 1000)}s: ${message.slice(0, 220)}`;
      const last = baseMessages.at(-1);
      if (last?.kind === "provider_retry") {
        return {
          ...state,
          recoveryPendingCount: nextRecovery,
          messages: [...baseMessages.slice(0, -1), { kind: "provider_retry", text: line }],
        };
      }
      return {
        ...state,
        recoveryPendingCount: nextRecovery,
        messages: [...baseMessages, { kind: "provider_retry", text: line }],
      };
    }

    case "tool_start": {
      const { callId, name } = action.payload;
      const baseAfterReasoning = finalizeStreamingModelReasoning(
        stripTrailingProviderRetry(state.messages)
      );
      if (name === "think") {
        return {
          ...state,
          messages: [
            ...baseAfterReasoning,
            {
              kind: "think",
              callId,
              streaming: true,
              argsJson: "",
              content: "",
            },
          ],
        };
      }
      if (name === "plan") {
        return {
          ...state,
          messages: [
            ...baseAfterReasoning,
            {
              kind: "plan",
              callId,
              streaming: true,
              argsJson: "",
              steps: [],
              previewText: "",
            },
          ],
        };
      }
      if (name === "reason") {
        return {
          ...state,
          messages: [
            ...baseAfterReasoning,
            {
              kind: "reason",
              callId,
              streaming: true,
              argsJson: "",
              inference: "",
            },
          ],
        };
      }
      if (ORCH_TOOLS.has(name)) return state;
      return {
        ...state,
        messages: [
          ...baseAfterReasoning,
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

    case "tool_delta": {
      const { callId, argsDelta } = action.payload;
      const thinkEntry = state.messages.find(
        (m): m is Extract<MessageEntry, { kind: "think" }> =>
          m.kind === "think" && m.streaming === true && m.callId === callId
      );
      if (thinkEntry) {
        const argsJson = (thinkEntry.argsJson ?? "") + argsDelta;
        return {
          ...state,
          messages: updateStreamingThinkFromArgs(state.messages, callId, argsJson),
        };
      }
      const reasonEntry = state.messages.find(
        (m): m is Extract<MessageEntry, { kind: "reason" }> =>
          m.kind === "reason" && m.streaming === true && m.callId === callId
      );
      if (reasonEntry) {
        const argsJson = (reasonEntry.argsJson ?? "") + argsDelta;
        return {
          ...state,
          messages: updateStreamingReasonFromArgs(state.messages, callId, argsJson),
        };
      }
      const planEntry = state.messages.find(
        (m): m is Extract<MessageEntry, { kind: "plan" }> =>
          m.kind === "plan" && m.streaming === true && m.callId === callId
      );
      if (planEntry) {
        const argsJson = (planEntry.argsJson ?? "") + argsDelta;
        return {
          ...state,
          messages: updateStreamingPlanFromArgs(state.messages, callId, argsJson),
        };
      }
      return {
        ...state,
        messages: state.messages.map((m) => {
          if (m.kind !== "tool_call" || m.callId !== callId) return m;
          return promoteWriteToolCallIfArgsComplete(m, m.argsJson + argsDelta);
        }),
      };
    }

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
        const finalized = {
          kind: "think" as const,
          callId,
          streaming: false as const,
          content: (args["content"] as string) ?? "",
          tool_families: args["tool_families"] as string[] | undefined,
          scope: args["scope"] as string | undefined,
          unknowns: args["unknowns"] as string[] | undefined,
          clarification_needed: args["clarification_needed"] as boolean | undefined,
          clarification_question: args["clarification_question"] as string | undefined,
          self_check: args["self_check"] as number | undefined,
        };
        const withoutStreaming = state.messages.filter(
          (m) => !(m.kind === "think" && m.streaming && m.callId === callId)
        );
        return { ...state, messages: [...withoutStreaming, finalized] };
      }
      if (name === "reason" && ok) {
        const finalized = {
          kind: "reason" as const,
          callId,
          streaming: false as const,
          inference: (args["inference"] as string) ?? "",
          confidence: args["confidence"] as "low" | "medium" | "high" | undefined,
          next_action: args["next_action"] as string | undefined,
        };
        const withoutStreaming = state.messages.filter(
          (m) => !(m.kind === "reason" && m.streaming && m.callId === callId)
        );
        return { ...state, messages: [...withoutStreaming, finalized] };
      }
      if (name === "plan" && ok) {
        const steps = Array.isArray(args["steps"])
          ? (args["steps"] as string[])
          : typeof args["step_index"] === "number"
          ? [`Step ${args["step_index"] as number} marked complete`]
          : [];
        const withoutStreaming = state.messages.filter(
          (m) => !(m.kind === "plan" && m.streaming && m.callId === callId)
        );
        return {
          ...state,
          messages: [...withoutStreaming, { kind: "plan", steps, streaming: false }],
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
      const msgs = finalizeOrphanToolCalls(
        finalizeStreamingReasoningEntries(
          stripTrailingProviderRetry(state.messages).map((m) =>
            m.kind === "assistant" && m.streaming ? { ...m, streaming: false } : m
          )
        )
      );
      const hm = action.payload.harnessMetrics as
        | {
            epistemicState?: { goal?: string; subgoals?: Array<{ id: string; status: string; note?: string }> };
            executionState?: { driftScore?: number; mission?: { objective?: string } };
            workingStatePreview?: string;
            terminationReason?: string;
          }
        | undefined;
      const extra: MessageEntry[] = [];
      if (hm?.epistemicState || hm?.executionState) {
        const subgoalsPreview = hm.epistemicState?.subgoals
          ?.slice(0, 4)
          .map((g) => `[${g.status}] ${g.id}${g.note ? `: ${g.note}` : ""}`)
          .join(" · ");
        extra.push({
          kind: "working_state",
          goal: hm.epistemicState?.goal,
          driftScore: hm.executionState?.driftScore,
          subgoalsPreview,
          executionPreview: hm.workingStatePreview ?? hm.executionState?.mission?.objective?.slice(0, 160),
        });
      }
      return {
        ...state,
        busy: false,
        contextSnapshot: action.payload.contextSnapshot,
        messages: [...msgs, ...extra],
        lastTurnProviderRetries: state.recoveryPendingCount,
        recoveryPendingCount: 0,
      };
    }

    case "turn_summary":
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            kind: "turn_header",
            intentClass: action.payload.intentClass,
            outcomeScore: action.payload.outcomeScore,
            toolCount: action.payload.toolCount,
            durationMs: action.payload.durationMs,
            keyTools: action.payload.keyTools,
            terminationReason: action.payload.terminationReason,
          },
        ],
      };

    case "tool_timing":
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.kind === "tool_call" && m.callId === action.payload.callId
            ? {
                ...m,
                endedAt: m.startedAt + action.payload.durationMs,
              }
            : m
        ),
      };

    case "sync_server_busy": {
      if (action.payload.busy) {
        return state.busy ? state : { ...state, busy: true };
      }
      if (!state.busy) return state;
      const msgs = stripTrailingProviderRetry(state.messages).map((m) =>
        m.kind === "assistant" && m.streaming ? { ...m, streaming: false } : m
      );
      const nextMessages = finalizeOrphanToolCalls(
        action.payload.addTraceNote
          ? [
              ...msgs,
              {
                kind: "trace" as const,
                text: "[UI] Unlocked — no SSE activity for a while while the server showed idle (heuristic fallback). Try refresh if the transcript looks incomplete.\n",
              },
            ]
          : msgs
      );
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
        messages: finalizeOrphanToolCalls(stripTrailingProviderRetry(state.messages)),
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
/**
 * Stall advisory when assistant tokens / tool SSE stall (distinct from periodic
 * `harness_running`, which proves the SSE socket is alive but not model progress).
 */
const BUSY_STALL_NO_SEMANTIC_SSE_MS = 52_000;
/** Subsequent stall reminders while still busy — long upstream reasoning can legitimately pause. */
const BUSY_STALL_SEMANTIC_REPEAT_MS = 240_000;
const SSE_RECONNECT_PROBE_MIN_INTERVAL_MS = 450;

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
      // 409 = duplicate send while agent is already processing — first attempt got through
      if (r.status === 409) {
        const errMsg = String((body as { error?: string }).error ?? "");
        if (/already processing/i.test(errMsg)) {
          return { ok: true, status: 409, body };
        }
        return { ok: false, status: 409, body };
      }
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

/** Wait until Express is up (web:dev often starts Vite before :3001 is listening). */
async function waitForApiReady(
  isCancelled: () => boolean,
  maxMs = 90_000
): Promise<boolean> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (isCancelled()) return false;
    const st = await fetchHarnessStatus();
    if (st) return true;
    await sleep(350);
  }
  return false;
}

function isAgentBusyResetConflict(status: number, body: unknown): boolean {
  if (status !== 409) return false;
  const errMsg = String((body as { error?: string }).error ?? "");
  return /agent is busy|wait for the current turn/i.test(errMsg);
}

async function postSessionReset(body: {
  mode: string;
  greet?: boolean;
}): Promise<{ ok: boolean; status: number; body: unknown; busy?: boolean }> {
  try {
    const r = await fetch(`${SERVER}/api/session/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const parsed = await r.json().catch(() => ({}));
    if (r.ok) return { ok: true, status: r.status, body: parsed };
    if (isAgentBusyResetConflict(r.status, parsed)) {
      return { ok: false, status: 409, body: parsed, busy: true };
    }
    return { ok: false, status: r.status, body: parsed };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      body: { error: e instanceof Error ? e.message : "Network error" },
    };
  }
}

/** Wait until harness idle, then soft/hard reset (avoids 409 on reload / Strict Mode / mid-turn refresh). */
const SESSION_RESET_IDLE_MAX_WAIT_MS = 90_000;
const SESSION_RESET_IDLE_POLL_MS = 400;

async function sessionResetWhenIdle(
  body: { mode: string; greet?: boolean },
  isCancelled: () => boolean
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const deadline = Date.now() + SESSION_RESET_IDLE_MAX_WAIT_MS;
  while (Date.now() < deadline) {
    if (isCancelled()) return { ok: false, status: 0, body: { error: "cancelled" } };
    const st = await fetchHarnessStatus();
    if (isCancelled()) return { ok: false, status: 0, body: { error: "cancelled" } };
    if (!st?.busy) {
      const result = await postSessionReset(body);
      if (result.ok) return result;
      if (result.busy) {
        await sleep(SESSION_RESET_IDLE_POLL_MS);
        continue;
      }
      return result;
    }
    await sleep(SESSION_RESET_IDLE_POLL_MS);
  }
  return {
    ok: false,
    status: 408,
    body: { error: "Timed out waiting for the agent to finish the current turn." },
  };
}

// ─── React hook ───────────────────────────────────────────────────────────────

export interface OutgoingChatMessage {
  text: string;
  attachments?: ImageAttachment[];
  /** True when the message was sent from live dictation (mic auto-send). */
  liveDictation?: boolean;
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
    sseTransport: "offline",
    sseTransportDetail: "",
    apiReachable: "unknown",
    sseHasOpenedOnce: false,
    busy: false,
    error: null,
    personaName: "Liminal",
    uiVerbosity: "normal",
    personaBootstrapPending: false,
    personaBootstrapAllowSkip: true,
    personaBootstrapProgress: null,
    personaBootstrapStage: null,
    personaBootstrapArtifacts: null,
    personaUiTheme: chrome?.personaUiTheme ?? null,
    personaDisplayLabel: chrome?.personaDisplayLabel ?? "LIMINAL",
    lastTurnProviderRetries: 0,
    recoveryPendingCount: 0,
    lastContextCompress: null,
    personalityPulseRows: [],
    personalityPulseActive: false,
    heartbeatUiStrip: false,
    heartbeatEnabled: false,
    dictationAudioCue: false,
    ttsEnabled: false,
  };
}

export type SpeechSsePayload = {
  clipId: string;
  text: string;
  audioUrl: string;
};

export function useSSE(options?: {
  onSpeechRef?: MutableRefObject<((payload: SpeechSsePayload) => void) | undefined>;
}) {
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
  const sseConnectedWaitersRef = useRef<Array<() => void>>([]);
  const cancelledRef = useRef(false);
  /** Bumps on each SSE effect run so stale auto-reset loops exit after unmount/remount. */
  const autoResetRunIdRef = useRef(0);
  const fetchConfigRef = useRef<() => void>(() => {});
  /** True from `user_message` until `turn_end` / `error` / forced status unlock. */
  const expectTurnEndRef = useRef(false);
  const turnSentAtMsRef = useRef(0);
  /** Any harness-related SSE pulse (incl. `harness_running` keepalive every 5s). */
  const lastHarnessActivityMsRef = useRef(0);
  /** Last streamed tokens, tools, or other user-visible harness work (NOT `harness_running` alone). */
  const lastSemanticHarnessActivityMsRef = useRef(0);
  const statusIdlePollStreakRef = useRef(0);
  const lastSeenServerTurnEndedAtRef = useRef<number | null>(null);
  const lastReconnectProbeAtRef = useRef(0);
  const uiVerbosityRef = useRef(state.uiVerbosity);
  /** Timestamp of last semantic-stall advisory trace (`0` until first advisory this busy span). */
  const lastSemanticStallAdvisoryAtMsRef = useRef(0);
  /** Mirrors live stream health for stall-copy (interval closures cannot read latest React state). */
  const streamLooksHealthyRef = useRef(false);
  /** Last chat id we cleared the transcript for — ignore duplicate `chat_switched`. */
  const streamBoundChatIdRef = useRef<string | null>(null);
  const connectStreamRef = useRef<(opts?: { replayHistory?: boolean }) => void>(() => {});
  const waitForSseOpenRef = useRef<(timeoutMs?: number) => Promise<boolean>>(async () => false);

  useEffect(() => {
    uiVerbosityRef.current = state.uiVerbosity;
  }, [state.uiVerbosity]);

  useEffect(() => {
    streamLooksHealthyRef.current =
      state.sseTransport === "open" &&
      state.connected &&
      state.apiReachable !== "down";
  }, [state.sseTransport, state.connected, state.apiReachable]);

  /** Server still attached — resets status-poll idle streaks. Does not imply model output. */
  const markHarnessConnectivityActivity = useCallback(() => {
    lastHarnessActivityMsRef.current = Date.now();
    statusIdlePollStreakRef.current = 0;
  }, []);

  const markHarnessSemanticActivity = useCallback(() => {
    lastHarnessActivityMsRef.current = Date.now();
    lastSemanticHarnessActivityMsRef.current = Date.now();
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
            payload: { busy: false, addTraceNote: false },
          });
        }
        return;
      }
      if (!expectTurnEndRef.current) return;
      const now = Date.now();
      if (now - turnSentAtMsRef.current < TURN_POST_SEND_GRACE_MS) return;
      if (now - lastSemanticHarnessActivityMsRef.current < HARNESS_ACTIVITY_IDLE_MS) return;
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
    if (!state.busy) {
      lastSemanticStallAdvisoryAtMsRef.current = 0;
      return;
    }
    // Capture when the UI entered busy state. For reconnect / server-initiated turns the
    // semantic-activity ref may still be at epoch (0), which would make semanticIdleMs
    // enormous and fire the advisory immediately. Use whichever is more recent: the busy
    // transition time or the last real model output, so the 52s window starts fresh.
    const busyBecameActiveAt = Date.now();
    const tick = (): void => {
      const baseline = Math.max(busyBecameActiveAt, lastSemanticHarnessActivityMsRef.current);
      const semanticIdleMs = Date.now() - baseline;
      if (semanticIdleMs < BUSY_STALL_NO_SEMANTIC_SSE_MS) return;
      const now = Date.now();
      const lastAdv = lastSemanticStallAdvisoryAtMsRef.current;
      const isFirstAdvice = lastAdv === 0;
      const elapsedSinceAdvice = lastAdv > 0 ? now - lastAdv : 0;
      if (!isFirstAdvice && elapsedSinceAdvice < BUSY_STALL_SEMANTIC_REPEAT_MS) return;
      lastSemanticStallAdvisoryAtMsRef.current = now;

      const minutes = Math.max(1, Math.round(semanticIdleMs / 60_000));
      const healthy = streamLooksHealthyRef.current;
      const delta = isFirstAdvice
        ? healthy
          ? `\n[UI] Busy ≥${Math.round(BUSY_STALL_NO_SEMANTIC_SSE_MS / 1000)}s with no streamed assistant or tool SSE — periodic harness_running pings only mean the stream is alive, not model tokens. Turn on RAW if you rely on harness trace lines quiet mode hides. Hangs before the first streamed chunk often clear only after NEW SESSION or restarting Express.\n`
          : `\n[UI] Busy ≥${Math.round(BUSY_STALL_NO_SEMANTIC_SSE_MS / 1000)}s with no assistant/tool SSE while SIGNAL degraded — reconnects or tab sleep are common; compare /api/status (busy) with /api/stream.\n`
        : healthy
          ? `\n[UI] Still no assistant/tool output after ~${minutes}m (SSE connected). Provider may stall before streaming; typed default AGENT_SEND_TIMEOUT_MS is often 1800s — check Express terminal for upstream errors.\n`
          : `\n[UI] Still no assistant/tool SSE after ~${minutes}m (stream unhealthy).\n`;

      dispatch({
        type: "text",
        payload: {
          channel: "trace",
          delta,
        },
      });
    };
    const id = window.setInterval(tick, 15_000);
    return () => window.clearInterval(id);
  }, [state.busy]);

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
              personaUiTheme?: PersonaUiThemeV2 | null;
              personaDisplayLabel?: string;
              personalityHeartbeatUiStrip?: boolean;
              personalityHeartbeatEnabled?: boolean;
              dictationAudioCue?: boolean;
              ttsEnabled?: boolean;
              activeChat?: { chatId?: string } | null;
            } | null
          ) => {
            if (!cancelledRef.current && cfg) {
              const activeId = cfg.activeChat?.chatId?.trim();
              if (activeId && streamBoundChatIdRef.current === null) {
                streamBoundChatIdRef.current = activeId;
              }
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
                dictationAudioCue: cfg.dictationAudioCue,
                ttsEnabled: cfg.ttsEnabled === true,
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

    const probeBootstrapApi = (): void => {
      void fetchHarnessStatus().then((st) => {
        if (cancelledRef.current) return;
        if (st) {
          dispatch({ type: "api_probe_result", payload: { apiReachable: "ok" } });
          return;
        }
        dispatch({
          type: "api_probe_result",
          payload: {
            apiReachable: "down",
            detail:
              "Cannot reach `/api/status` — Express may be down or `web:dev` cannot proxy to `:3001` (ECONNRESET while restarting is common).",
          },
        });
      });
    };

    /**
     * When SSE flakes, correlate with REST so we avoid labelling transient stalls as OFFLINE.
     */
    function probeAfterStreamInterrupt(
      reason: "CONNECTING" | "CLOSED",
      opts: { throttle: boolean; reconnectOrdinal?: number },
    ): void {
      const now = Date.now();
      if (
        opts.throttle &&
        now - lastReconnectProbeAtRef.current < SSE_RECONNECT_PROBE_MIN_INTERVAL_MS
      ) {
        return;
      }
      lastReconnectProbeAtRef.current = now;

      void fetchHarnessStatus().then((st) => {
        if (cancelledRef.current) return;
        if (!st) {
          dispatch({
            type: "api_probe_result",
            payload: {
              apiReachable: "down",
              detail:
                "SSE interrupted — cannot reach `/api/status` (server stopped, blocked, or stale dev proxy).",
            },
          });
          return;
        }

        dispatch({ type: "api_probe_result", payload: { apiReachable: "ok" } });

        const ordinal = opts.reconnectOrdinal ?? reconnectAttempt.current;
        const base =
          reason === "CLOSED"
            ? "SSE connection closed — scheduling reconnect"
            : "SSE stuck in CONNECTING — native retry or 2s takeover will reopen";
        dispatch({
          type: "sse_reconnecting",
          payload: {
            detail: base,
            attempt: Math.max(0, ordinal),
            serverBusy: st.busy === true,
          },
        });

        if (uiVerbosityRef.current !== "normal" || ordinal < 2) return;
        dispatch({
          type: "text",
          payload: {
            channel: "trace",
            delta: `\n[UI/SSE] ${reason} reconnect · shown_attempt=${ordinal}${st.busy ? " · api_busy" : ""}\n`,
          },
        });
      });
    }

    fetchAndApplyConfig();
    probeBootstrapApi();

    function persistEventId(id: string | undefined): void {
      if (!id) return;
      lastEventId.current = id;
      writeStoredLastEventId(id);
    }

    function buildStreamUrl(opts?: { replayHistory?: boolean }): string {
      if (opts?.replayHistory) {
        return `${SERVER}/api/stream?replayHistory=1`;
      }
      const eid = lastEventId.current ?? readStoredLastEventId();
      if (eid) {
        return `${SERVER}/api/stream?lastEventId=${encodeURIComponent(eid)}`;
      }
      return `${SERVER}/api/stream`;
    }

    function waitForSseOpen(timeoutMs = 20_000): Promise<boolean> {
      if (esRef.current?.readyState === EventSource.OPEN) return Promise.resolve(true);
      return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), timeoutMs);
        sseConnectedWaitersRef.current.push(() => {
          clearTimeout(timer);
          resolve(esRef.current?.readyState === EventSource.OPEN);
        });
      });
    }

    function connect(opts?: { replayHistory?: boolean }) {
      if (cancelledRef.current) return;

      const url = buildStreamUrl(opts);
      const es = new EventSource(url);
      esRef.current = es;

      es.addEventListener("connected", (e: MessageEvent) => {
        // Clear any pending CONNECTING-state takeover timer — we made it.
        if (reconnectTimer.current) { clearTimeout(reconnectTimer.current); reconnectTimer.current = null; }
        reconnectAttempt.current = 0;
        const payload = parseEventData(e) as { cursor?: number } | undefined;
        const cursor =
          typeof payload?.cursor === "number" && Number.isFinite(payload.cursor)
            ? payload.cursor
            : 0;
        const stored = lastEventId.current ?? readStoredLastEventId();
        if (stored) {
          const storedNum = Number.parseInt(stored, 10);
          if (Number.isFinite(storedNum) && storedNum > cursor) {
            clearStoredLastEventId();
            lastEventId.current = undefined;
          }
        }
        dispatch({ type: "connected" });
        void reconcileBusyFromStatus({ forceIfServerBusy: true });
        fetchAndApplyConfig();
        const waiters = sseConnectedWaitersRef.current.splice(0);
        for (const wake of waiters) wake();
      });

      // Phase 2 per-chat workspaces: when the server switches the active chat,
      // wipe the local transcript so the UI doesn't bleed one chat's messages
      // into another's, then bubble a window event so useChats() refreshes.
      es.addEventListener("chat_switched", (e: MessageEvent) => {
        trackId(e);
        const payload = parseEventData(e) as
          | { chatId?: string; title?: string; workspaceRoot?: string; workspaceFingerprint?: string; workspaceMode?: string; at?: number }
          | undefined;
        if (!payload) return;
        const chatId = String(payload.chatId ?? "");
        if (streamBoundChatIdRef.current === chatId) {
          fetchAndApplyConfig();
          try {
            window.dispatchEvent(new CustomEvent("liminal:chat_switched", { detail: payload }));
          } catch {
            /* ignore */
          }
          return;
        }
        streamBoundChatIdRef.current = chatId;
        dispatch({ type: "session_reset" });
        fetchAndApplyConfig();
        // Notify the chat hook + any other listeners.
        try {
          window.dispatchEvent(new CustomEvent("liminal:chat_switched", { detail: payload }));
        } catch {
          /* ignore */
        }
      });

      // Grab the event ID from every event so we can resume after reconnect.
      const trackId = (e: MessageEvent) => {
        persistEventId(e.lastEventId || undefined);
      };

      es.addEventListener("text", (e: MessageEvent) => {
        trackId(e);
        const payload = parseEventData(e) as {
          delta?: string;
          channel?: "user" | "trace" | "reasoning";
        } | undefined;
        if (!payload || typeof payload.delta !== "string") return;
        // Count trace + user deltas as harness activity so long reasoning-only streams
        // and quiet periods between tools do not trip the status-poll idle unlock path.
        markHarnessSemanticActivity();
        const cleaned = sanitizeDeltaText(payload.delta);
        const ch = payload.channel ?? "user";
        if (ch === "reasoning") {
          flushNow();
          dispatch({ type: "text", payload: { delta: cleaned, channel: "reasoning" } });
          return;
        }
        if (ch === "trace") {
          queuedTrace.current += cleaned;
          queueFlush();
          return;
        }
        // Assistant/user tokens must paint as they arrive — batching collapses live streams
        // and replays into one visible chunk after the 40ms timer fires.
        flushNow();
        dispatch({ type: "text", payload: { delta: cleaned, channel: ch } });
      });

      es.addEventListener("provider_retry", (e: MessageEvent) => {
        trackId(e);
        markHarnessSemanticActivity();
        const p = parseEventData(e);
        if (p == null) return;
        dispatch({ type: "provider_retry", payload: p as never });
      });
      es.addEventListener("speech", (e: MessageEvent) => {
        markHarnessSemanticActivity();
        try {
          const p = JSON.parse(e.data) as SpeechSsePayload;
          if (p?.clipId && p?.audioUrl) options?.onSpeechRef?.current?.(p);
        } catch {
          /* ignore malformed */
        }
      });

      es.addEventListener("tool_start", (e: MessageEvent) => {
        trackId(e);
        markHarnessSemanticActivity();
        flushNow();
        const p = parseEventData(e);
        if (p == null) return;
        dispatch({ type: "tool_start", payload: p as never });
      });
      es.addEventListener("tool_delta", (e: MessageEvent) => {
        trackId(e);
        markHarnessSemanticActivity();
        flushNow();
        const p = parseEventData(e);
        if (p == null) return;
        dispatch({ type: "tool_delta", payload: p as never });
      });
      es.addEventListener("tool_approval", (e: MessageEvent) => {
        trackId(e);
        markHarnessSemanticActivity();
        flushNow();
        const p = parseEventData(e);
        if (p == null) return;
        dispatch({ type: "tool_approval", payload: p as never });
      });
      es.addEventListener("tool_result", (e: MessageEvent) => {
        trackId(e);
        markHarnessSemanticActivity();
        flushNow();
        const p = parseEventData(e);
        if (p == null) return;
        dispatch({ type: "tool_result", payload: p as never });
      });
      es.addEventListener("ask_user", (e: MessageEvent) => {
        trackId(e);
        markHarnessSemanticActivity();
        flushNow();
        const p = parseEventData(e);
        if (p == null) return;
        dispatch({ type: "ask_user", payload: p as never });
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
        const p = parseEventData(e);
        if (p == null) return;
        dispatch({ type: "turn_end", payload: p as never });
      });
      es.addEventListener("subtask_spawned", (e: MessageEvent) => {
        trackId(e);
        markHarnessSemanticActivity();
        flushNow();
        const p = parseEventData(e);
        if (p == null) return;
        dispatch({ type: "subtask_spawned", payload: p as never });
      });
      es.addEventListener("subtask_complete", (e: MessageEvent) => {
        trackId(e);
        markHarnessSemanticActivity();
        flushNow();
        const p = parseEventData(e);
        if (p == null) return;
        dispatch({ type: "subtask_complete", payload: p as never });
      });
      es.addEventListener("subtask_output", (e: MessageEvent) => {
        trackId(e);
        markHarnessSemanticActivity();
        flushNow();
        const p = parseEventData(e);
        if (p == null) return;
        dispatch({ type: "subtask_output", payload: p as never });
      });
      es.addEventListener("plan_step_done", (e: MessageEvent) => {
        trackId(e);
        markHarnessSemanticActivity();
        flushNow();
        const p = parseEventData(e);
        if (p == null) return;
        dispatch({ type: "plan_step_done", payload: p as never });
      });
      es.addEventListener("context_compressed", (e: MessageEvent) => {
        trackId(e);
        markHarnessSemanticActivity();
        flushNow();
        const p = parseEventData(e);
        if (p == null) return;
        dispatch({ type: "context_compressed", payload: p as never });
      });
      es.addEventListener("persona_changed", (e: MessageEvent) => {
        trackId(e); flushNow();
        const p = parseEventData(e);
        if (p == null) return;
        dispatch({ type: "persona_changed", payload: p as never });
        fetchConfigRef.current();
      });
      es.addEventListener("auto_dream", (e: MessageEvent) => {
        trackId(e);
        const p = parseEventData(e);
        if (p == null) return;
        dispatch({ type: "auto_dream", payload: p as never });
      });
      es.addEventListener("heartbeat_scheduled", (e: MessageEvent) => {
        trackId(e);
        const p = parseEventData(e);
        if (p == null) return;
        dispatch({ type: "heartbeat_scheduled", payload: p as never });
      });
      es.addEventListener("heartbeat_started", (e: MessageEvent) => {
        trackId(e);
        const p = parseEventData(e);
        if (p == null) return;
        dispatch({ type: "heartbeat_started", payload: p as never });
      });
      es.addEventListener("heartbeat_completed", (e: MessageEvent) => {
        trackId(e);
        const p = parseEventData(e);
        if (p == null) return;
        dispatch({ type: "heartbeat_completed", payload: p as never });
      });
      es.addEventListener("heartbeat_skipped", (e: MessageEvent) => {
        trackId(e);
        const p = parseEventData(e);
        if (p == null) return;
        dispatch({ type: "heartbeat_skipped", payload: p as never });
      });
      es.addEventListener("persona_bootstrap_progress", (e: MessageEvent) => {
        trackId(e);
        const p = parseEventData(e);
        if (p == null) return;
        dispatch({ type: "persona_bootstrap_progress", payload: p as never });
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
        const p = parseEventData(e) as { summary?: string; risky?: boolean } | undefined;
        if (!p || typeof p.summary !== "string") return;
        dispatch({ type: "text", payload: { channel: "trace", delta: `\n[prefs] detected risky=${p.risky ? "yes" : "no"} ${p.summary}\n` } });
      });
      es.addEventListener("runtime_pref_changed", (e: MessageEvent) => {
        trackId(e);
        const p = parseEventData(e) as {
          summary?: string;
          persisted?: boolean;
          personaControls?: {
            humorPercent?: number;
            formality?: string;
            confidence?: number;
            verbosity?: string;
            personaStrength?: number;
          };
        } | undefined;
        if (!p || typeof p.summary !== "string") return;
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
        const p = parseEventData(e) as { path?: string } | undefined;
        if (!p || typeof p.path !== "string") return;
        dispatch({ type: "text", payload: { channel: "trace", delta: `\n[prefs] persisted path=${p.path}\n` } });
      });
      es.addEventListener("runtime_pref_rejected", (e: MessageEvent) => {
        trackId(e);
        const p = parseEventData(e) as { summary?: string; reason?: string } | undefined;
        if (!p || typeof p.summary !== "string" || typeof p.reason !== "string") return;
        dispatch({ type: "text", payload: { channel: "trace", delta: `\n[prefs] rejected ${p.summary} (${p.reason})\n` } });
      });

      // harness_running — emitted every 5 s while agent is mid-turn.
      // Lands in SSE history so reconnecting clients know work is ongoing.
      es.addEventListener("harness_running", (e: MessageEvent) => {
        trackId(e);
        markHarnessConnectivityActivity();
        const p = parseEventData(e);
        if (p == null) return;
        dispatch({ type: "harness_running", payload: p as never });
      });

      es.addEventListener("turn_summary", (e: MessageEvent) => {
        trackId(e);
        markHarnessSemanticActivity();
        flushNow();
        const p = parseEventData(e);
        if (p == null || typeof p !== "object") return;
        const o = p as Record<string, unknown>;
        dispatch({
          type: "turn_summary",
          payload: {
            intentClass: String(o.intentClass ?? "general"),
            outcomeScore: Number(o.outcomeScore ?? 0),
            toolCount: Number(o.toolCount ?? 0),
            durationMs: Number(o.durationMs ?? 0),
            keyTools: Array.isArray(o.keyTools) ? (o.keyTools as string[]) : [],
            terminationReason: String(o.terminationReason ?? "ok"),
          },
        });
      });

      es.addEventListener("tool_timing", (e: MessageEvent) => {
        trackId(e);
        const p = parseEventData(e);
        if (p == null || typeof p !== "object") return;
        const o = p as Record<string, unknown>;
        if (typeof o.callId !== "string" || typeof o.durationMs !== "number") return;
        dispatch({ type: "tool_timing", payload: { callId: o.callId, durationMs: o.durationMs } });
      });

      // Ack-only events — no UI effect needed.
      ["ask_user_answered", "approval_decision", "vault_activity",
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
          probeAfterStreamInterrupt("CONNECTING", { throttle: true });
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
        const ordinal = reconnectAttempt.current + 1;
        probeAfterStreamInterrupt("CLOSED", { throttle: false, reconnectOrdinal: ordinal });
        es.close();
        esRef.current = null;
        const delay = reconnectDelay(reconnectAttempt.current);
        reconnectAttempt.current = Math.min(reconnectAttempt.current + 1, 6);
        reconnectTimer.current = setTimeout(connect, delay);
      };
    }

    connectStreamRef.current = connect;
    waitForSseOpenRef.current = waitForSseOpen;

    void (async () => {
      const captureMode =
        typeof window !== "undefined" &&
        new URLSearchParams(window.location.search).get("capture") === "1";

      if (!captureMode) {
        const apiReady = await waitForApiReady(() => cancelledRef.current);
        if (cancelledRef.current) return;
        if (!apiReady) {
          dispatch({
            type: "error",
            payload: {
              message:
                "Cannot reach the Liminal API yet. If you use web:dev, wait for Express on :3001 or reload after the server finishes restarting.",
            },
          });
          return;
        }
      }

      // User preference: greet on every page load (including reload), not just the
      // first load per tab. Reset the persisted per-tab "already greeted" marker so
      // the gate below opens each load. The in-memory `autoGreetAttemptedThisPageLoad`
      // still de-dupes the React Strict Mode double-mount within a single page load.
      // NOTE: each greet runs a soft reset, so a reload starts a fresh conversation.
      if (!captureMode) clearAutoGreetDone();

      const needsAutoGreet =
        !captureMode && !isAutoGreetDone() && !autoGreetAttemptedThisPageLoad;

      if (needsAutoGreet) {
        autoGreetAttemptedThisPageLoad = true;
        dispatch({ type: "session_reset" });
        connect();
        const runId = ++autoResetRunIdRef.current;
        const streamReady = await waitForSseOpen();
        if (cancelledRef.current || autoResetRunIdRef.current !== runId) return;
        if (!streamReady) {
          autoGreetAttemptedThisPageLoad = false;
          dispatch({
            type: "error",
            payload: { message: "Could not open event stream before session greeting." },
          });
          return;
        }
        const resetResult = await sessionResetWhenIdle(
          { mode: "soft", greet: true },
          () => cancelledRef.current || autoResetRunIdRef.current !== runId
        );
        const greeted =
          resetResult.ok &&
          (resetResult.body as { greeted?: boolean }).greeted === true;
        if (greeted) markAutoGreetDone();
        else if (!resetResult.ok) autoGreetAttemptedThisPageLoad = false;
        return;
      }

      // Auto-greet already ran this tab (remount / bfcache / return): replay SSE, no server reset.
      const storedEid = readStoredLastEventId();
      if (storedEid) lastEventId.current = storedEid;
      if (!cancelledRef.current) {
        connect({ replayHistory: !captureMode });
      }
    })();

    // When the tab becomes visible after being hidden, browsers throttle/freeze
    // timers — reconnect immediately if the connection is stale.
    const resumeStreamAfterInterrupt = () => {
      if (cancelledRef.current) return;
      if (!esRef.current || esRef.current.readyState !== EventSource.OPEN) {
        if (reconnectTimer.current) {
          clearTimeout(reconnectTimer.current);
          reconnectTimer.current = null;
        }
        esRef.current?.close();
        esRef.current = null;
        reconnectAttempt.current = 0;
        connect();
      } else {
        void reconcileBusyFromStatus({ forceIfServerBusy: true });
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible" || cancelledRef.current) return;
      resumeStreamAfterInterrupt();
    };

    const handlePageShow = (ev: PageTransitionEvent) => {
      if (cancelledRef.current) return;
      if (ev.persisted) {
        resumeStreamAfterInterrupt();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pageshow", handlePageShow);

    return () => {
      cancelledRef.current = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pageshow", handlePageShow);
      if (flushTimer.current) clearTimeout(flushTimer.current);
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      esRef.current?.close();
      esRef.current = null;
    };
  }, [markHarnessSemanticActivity, markHarnessConnectivityActivity, reconcileBusyFromStatus]);

  const sendMessage = useCallback(async (payload: OutgoingChatMessage): Promise<SendMessageResult> => {
    const text = payload.text.trim();
    const attachmentCount = payload.attachments?.length ?? 0;
    const renderedUserMessage =
      attachmentCount > 0 ? `${text || "(no text)"}\n[attached images: ${attachmentCount}]` : text;
    const now = Date.now();
    turnSentAtMsRef.current = now;
    lastHarnessActivityMsRef.current = now;
    lastSemanticHarnessActivityMsRef.current = now;
    lastSemanticStallAdvisoryAtMsRef.current = 0;
    expectTurnEndRef.current = true;
    statusIdlePollStreakRef.current = 0;
    dispatch({ type: "user_message", text: renderedUserMessage });

    if (!esRef.current || esRef.current.readyState !== EventSource.OPEN) {
      connectStreamRef.current();
      await waitForSseOpenRef.current(12_000);
    }

    const result = await fetchWithRetry(
      `${SERVER}/api/message`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          attachments: payload.attachments ?? [],
          liveDictation: Boolean(payload.liveDictation),
        }),
      },
      8
    );

    if (!result.ok) {
      expectTurnEndRef.current = false;
      const message = (result.body as { error?: string }).error ?? `Send failed (${result.status})`;
      dispatch({ type: "error", payload: { message } });
      dispatch({ type: "remove_last_user_message" });
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
    const result = await sessionResetWhenIdle({ mode: "soft" }, () => false);
    if (result.ok) {
      expectTurnEndRef.current = false;
      statusIdlePollStreakRef.current = 0;
      clearStoredLastEventId();
      clearAutoGreetDone();
      streamBoundChatIdRef.current = null;
      lastEventId.current = undefined;
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

  return { state, sendMessage, sendApproval, sendAnswer, sendClearSession, sendPersonaBootstrap, sendAbortTurn };
}

export async function sendAbortTurn(): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(`${SERVER}/api/session/abort`, { method: "POST" });
    if (!r.ok) {
      const body = (await r.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: body.error ?? `HTTP ${r.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error" };
  }
}
