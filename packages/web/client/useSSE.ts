import { useEffect, useReducer, useCallback, useRef } from "react";
import type { ImageAttachment } from "./imageAttachments.js";

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
}

const ORCH_TOOLS = new Set(["spawn_agent", "wait_for_agents", "cancel_agent", "list_agents"]);

type Action =
  | {
      type: "init_config";
      uiVerbosity: "normal" | "quiet";
      personaBootstrapPending?: boolean;
      personaBootstrapAllowSkip?: boolean;
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
  | { type: "persona_bootstrap_progress"; payload: { stage: string; message: string; at: number } }
  | { type: "session_reset" };

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
      };

    case "connected":
      return { ...state, connected: true, error: null };

    case "disconnected":
      return { ...state, connected: false, error: state.error ?? "Connection lost. Reconnecting..." };

    case "harness_running":
      // Received while reconnecting — confirms work is still in progress.
      return { ...state, busy: true };

    case "session_reset":
      return {
        ...state,
        messages: [],
        busy: false,
        error: null,
        contextSnapshot: null,
        pendingApproval: null,
        pendingAskUser: null,
        personaBootstrapPending: state.personaBootstrapPending,
        personaBootstrapProgress: null,
        personaBootstrapStage: null,
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
      if (state.uiVerbosity === "quiet") return state;
      const { attempt, maxAttempts, message, backoffMs } = action.payload;
      const maxLabel = maxAttempts > 0 ? String(maxAttempts) : "∞";
      const line = `⟳ Provider retry ${attempt}/${maxLabel} in ${Math.round(backoffMs / 1000)}s: ${message.slice(0, 220)}`;
      const last = state.messages.at(-1);
      if (last?.kind === "provider_retry") {
        return {
          ...state,
          messages: [...state.messages.slice(0, -1), { kind: "provider_retry", text: line }],
        };
      }
      return {
        ...state,
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

    case "turn_end":
      return {
        ...state,
        busy: false,
        contextSnapshot: action.payload.contextSnapshot,
        messages: stripTrailingProviderRetry(state.messages).map((m) =>
          m.kind === "assistant" && m.streaming ? { ...m, streaming: false } : m
        ),
      };

    case "error":
      return {
        ...state,
        busy: false,
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

    case "context_compressed":
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            kind: "context_compressed",
            beforePct: Math.round(action.payload.beforeFraction * 100),
            afterPct: Math.round(action.payload.afterFraction * 100),
            rounds: action.payload.roundsCompressed,
          },
        ],
      };

    case "persona_changed":
      return { ...state, personaName: action.payload.name };
  }
}

const SERVER = "http://localhost:3001";

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
  for (let i = 0; i < maxAttempts; i++) {
    if (i > 0) await sleep(postDelay(i - 1));
    try {
      const r = await fetch(url, init);
      const body = await r.json().catch(() => ({}));
      // 409 = agent busy; treat as success — first attempt got through
      if (r.status === 409) return { ok: true, status: 409, body };
      // 4xx client error — don't retry
      if (r.status >= 400 && r.status < 500) return { ok: false, status: r.status, body };
      if (r.ok) return { ok: true, status: r.status, body };
      lastErr = (body as { error?: string }).error ?? `HTTP ${r.status}`;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : "Network error";
    }
  }
  return { ok: false, status: 0, body: { error: lastErr } };
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

export function useSSE() {
  const [state, dispatch] = useReducer(reducer, {
    messages: [],
    contextSnapshot: null,
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
  });

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

    // Fetch config once — fire-and-forget, never blocks the SSE connection.
    fetch(`${SERVER}/api/config`)
      .then((r) => r.ok ? r.json() : null)
      .then(
        (
          cfg:
            | {
                uiVerbosity?: string;
                personaBootstrapPending?: boolean;
                personaBootstrapAllowSkip?: boolean;
              }
            | null
        ) => {
          if (!cancelledRef.current && cfg) {
            dispatch({
              type: "init_config",
              uiVerbosity: cfg.uiVerbosity === "quiet" ? "quiet" : "normal",
              personaBootstrapPending: cfg.personaBootstrapPending,
              personaBootstrapAllowSkip: cfg.personaBootstrapAllowSkip,
            });
          }
        }
      )
      .catch(() => { /* default normal */ });

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
      });

      // Grab the event ID from every event so we can resume after reconnect.
      const trackId = (e: MessageEvent) => {
        if (e.lastEventId) lastEventId.current = e.lastEventId;
      };

      es.addEventListener("text", (e: MessageEvent) => {
        trackId(e);
        const payload = JSON.parse(e.data) as { delta: string; channel?: "user" | "trace" };
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
        trackId(e); flushNow();
        dispatch({ type: "tool_result", payload: JSON.parse(e.data) });
      });
      es.addEventListener("ask_user", (e: MessageEvent) => {
        trackId(e); flushNow();
        dispatch({ type: "ask_user", payload: JSON.parse(e.data) });
      });
      es.addEventListener("turn_end", (e: MessageEvent) => {
        trackId(e); flushNow();
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
      });
      es.addEventListener("persona_bootstrap_progress", (e: MessageEvent) => {
        trackId(e);
        dispatch({ type: "persona_bootstrap_progress", payload: JSON.parse(e.data) });
      });
      es.addEventListener("error", (e: MessageEvent) => {
        trackId(e); flushNow();
        dispatch({ type: "error", payload: JSON.parse((e as MessageEvent).data ?? '{"message":"Agent error"}') });
      });
      es.addEventListener("runtime_pref_detected", (e: MessageEvent) => {
        trackId(e);
        const p = JSON.parse(e.data) as { summary: string; risky: boolean };
        dispatch({ type: "text", payload: { channel: "trace", delta: `\n[prefs] detected risky=${p.risky ? "yes" : "no"} ${p.summary}\n` } });
      });
      es.addEventListener("runtime_pref_changed", (e: MessageEvent) => {
        trackId(e);
        const p = JSON.parse(e.data) as { summary: string; persisted: boolean };
        dispatch({ type: "text", payload: { channel: "trace", delta: `\n[prefs] changed persisted=${p.persisted ? "yes" : "no"} ${p.summary}\n` } });
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
  }, []); // stable — no deps needed, all state tracked via refs

  const sendMessage = useCallback(async (payload: OutgoingChatMessage): Promise<SendMessageResult> => {
    const text = payload.text.trim();
    const attachmentCount = payload.attachments?.length ?? 0;
    const renderedUserMessage =
      attachmentCount > 0 ? `${text || "(no text)"}\n[attached images: ${attachmentCount}]` : text;
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
    const result = await fetchWithRetry(`${SERVER}/api/session/reset`, { method: "POST" }, 4);
    if (result.ok) {
      dispatch({ type: "session_reset" });
      // Refresh config so bootstrap modal state is accurate after reset.
      fetch(`${SERVER}/api/config`)
        .then((r) => (r.ok ? r.json() : null))
        .then(
          (
            cfg:
              | {
                  uiVerbosity?: string;
                  personaBootstrapPending?: boolean;
                  personaBootstrapAllowSkip?: boolean;
                }
              | null
          ) => {
            if (cfg) {
              dispatch({
                type: "init_config",
                uiVerbosity: cfg.uiVerbosity === "quiet" ? "quiet" : "normal",
                personaBootstrapPending: cfg.personaBootstrapPending,
                personaBootstrapAllowSkip: cfg.personaBootstrapAllowSkip,
              });
            }
          }
        )
        .catch(() => { /* ignore */ });
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
      return { ok: true };
    },
    [state.uiVerbosity]
  );

  return { state, sendMessage, sendApproval, sendAnswer, sendClearSession, sendPersonaBootstrap };
}
