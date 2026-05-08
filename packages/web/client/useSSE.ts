import { useEffect, useReducer, useCallback } from "react";
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
}

const ORCH_TOOLS = new Set(["spawn_agent", "wait_for_agents", "cancel_agent", "list_agents"]);

type Action =
  | { type: "init_config"; uiVerbosity: "normal" | "quiet" }
  | { type: "connected" }
  | { type: "disconnected" }
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
  | { type: "session_reset" };

function stripTrailingProviderRetry(messages: MessageEntry[]): MessageEntry[] {
  const last = messages.at(-1);
  if (last?.kind === "provider_retry") return messages.slice(0, -1);
  return messages;
}

function reducer(state: SSEState, action: Action): SSEState {
  switch (action.type) {
    case "init_config":
      return { ...state, uiVerbosity: action.uiVerbosity };

    case "connected":
      return { ...state, connected: true, error: null };

    case "disconnected":
      return { ...state, connected: false, error: state.error ?? "Connection lost. Reconnecting..." };

    case "session_reset":
      return {
        ...state,
        messages: [],
        busy: false,
        error: null,
        contextSnapshot: null,
        pendingApproval: null,
        pendingAskUser: null,
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
      // Transition the approved tool_call from pending_approval → running
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
  });

  useEffect(() => {
    let es: EventSource | null = null;
    let cancelled = false;
    let queuedText = "";
    let queuedTrace = "";
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      flushTimer = null;
      if (queuedText) {
        dispatch({ type: "text", payload: { delta: queuedText, channel: "user" } });
        queuedText = "";
      }
      if (queuedTrace) {
        dispatch({ type: "text", payload: { delta: queuedTrace, channel: "trace" } });
        queuedTrace = "";
      }
    };
    const queueFlush = () => {
      if (flushTimer) return;
      flushTimer = setTimeout(flush, 40);
    };
    const flushNow = () => {
      if (flushTimer) clearTimeout(flushTimer);
      flush();
    };

    void (async () => {
      try {
        const r = await fetch(`${SERVER}/api/config`);
        if (r.ok) {
          const cfg = (await r.json()) as { uiVerbosity?: string };
          if (!cancelled && cfg.uiVerbosity === "quiet") {
            dispatch({ type: "init_config", uiVerbosity: "quiet" });
          }
        }
      } catch {
        /* default normal */
      }
      if (cancelled) return;

      es = new EventSource(`${SERVER}/api/stream`);

      es.addEventListener("connected", () => dispatch({ type: "connected" }));
      es.addEventListener("text", (e: MessageEvent) => {
        const payload = JSON.parse(e.data) as { delta: string; channel?: "user" | "trace" };
        const cleaned = sanitizeDeltaText(payload.delta);
        if ((payload.channel ?? "user") === "trace") queuedTrace += cleaned;
        else queuedText += cleaned;
        queueFlush();
      });
      es.addEventListener("provider_retry", (e: MessageEvent) =>
        dispatch({ type: "provider_retry", payload: JSON.parse(e.data) })
      );
      es.addEventListener("tool_start", (e: MessageEvent) => {
        flushNow();
        dispatch({ type: "tool_start", payload: JSON.parse(e.data) });
      });
      es.addEventListener("tool_delta", (e: MessageEvent) => {
        flushNow();
        dispatch({ type: "tool_delta", payload: JSON.parse(e.data) });
      });
      es.addEventListener("tool_approval", (e: MessageEvent) => {
        flushNow();
        dispatch({ type: "tool_approval", payload: JSON.parse(e.data) });
      });
      es.addEventListener("tool_result", (e: MessageEvent) => {
        flushNow();
        dispatch({ type: "tool_result", payload: JSON.parse(e.data) });
      });
      es.addEventListener("ask_user", (e: MessageEvent) => {
        flushNow();
        dispatch({ type: "ask_user", payload: JSON.parse(e.data) });
      });
      es.addEventListener("turn_end", (e: MessageEvent) => {
        flushNow();
        dispatch({ type: "turn_end", payload: JSON.parse(e.data) });
      });
      es.addEventListener("subtask_spawned", (e: MessageEvent) => {
        flushNow();
        dispatch({ type: "subtask_spawned", payload: JSON.parse(e.data) });
      });
      es.addEventListener("subtask_complete", (e: MessageEvent) => {
        flushNow();
        dispatch({ type: "subtask_complete", payload: JSON.parse(e.data) });
      });
      es.addEventListener("plan_step_done", (e: MessageEvent) => {
        flushNow();
        dispatch({ type: "plan_step_done", payload: JSON.parse(e.data) });
      });
      es.addEventListener("context_compressed", (e: MessageEvent) => {
        flushNow();
        dispatch({ type: "context_compressed", payload: JSON.parse(e.data) });
      });
      es.addEventListener("persona_changed", (e: MessageEvent) => {
        flushNow();
        dispatch({ type: "persona_changed", payload: JSON.parse(e.data) });
      });
      es.addEventListener("subtask_output", (e: MessageEvent) => {
        flushNow();
        dispatch({ type: "subtask_output", payload: JSON.parse(e.data) });
      });
      es.addEventListener("runtime_pref_detected", (e: MessageEvent) => {
        const p = JSON.parse(e.data) as { summary: string; risky: boolean };
        dispatch({
          type: "text",
          payload: {
            channel: "trace",
            delta: `\n[prefs] detected risky=${p.risky ? "yes" : "no"} ${p.summary}\n`,
          },
        });
      });
      es.addEventListener("runtime_pref_changed", (e: MessageEvent) => {
        const p = JSON.parse(e.data) as { summary: string; persisted: boolean };
        dispatch({
          type: "text",
          payload: {
            channel: "trace",
            delta: `\n[prefs] changed persisted=${p.persisted ? "yes" : "no"} ${p.summary}\n`,
          },
        });
      });
      es.addEventListener("runtime_pref_persisted", (e: MessageEvent) => {
        const p = JSON.parse(e.data) as { path: string };
        dispatch({
          type: "text",
          payload: { channel: "trace", delta: `\n[prefs] persisted path=${p.path}\n` },
        });
      });
      es.addEventListener("runtime_pref_rejected", (e: MessageEvent) => {
        const p = JSON.parse(e.data) as { summary: string; reason: string };
        dispatch({
          type: "text",
          payload: { channel: "trace", delta: `\n[prefs] rejected ${p.summary} (${p.reason})\n` },
        });
      });
      es.addEventListener("ask_user_answered", () => {});
      es.addEventListener("approval_decision", () => {});
      es.addEventListener("tool_timing", () => {});
      es.addEventListener("error", (e: MessageEvent) =>
        dispatch({
          type: "error",
          payload: JSON.parse((e as MessageEvent).data ?? '{"message":"Connection error"}'),
        })
      );
      es.onerror = () => dispatch({ type: "disconnected" });
    })();

    return () => {
      cancelled = true;
      if (flushTimer) clearTimeout(flushTimer);
      flush();
      es?.close();
    };
  }, []);

  const sendMessage = useCallback(async (payload: OutgoingChatMessage): Promise<SendMessageResult> => {
    const text = payload.text.trim();
    const attachmentCount = payload.attachments?.length ?? 0;
    const renderedUserMessage =
      attachmentCount > 0 ? `${text || "(no text)"}\n[attached images: ${attachmentCount}]` : text;
    dispatch({ type: "user_message", text: renderedUserMessage });
    try {
      const r = await fetch(`${SERVER}/api/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, attachments: payload.attachments ?? [] }),
      });
      if (!r.ok) {
        const p = (await r.json().catch(() => ({}))) as { error?: string };
        const message = p.error ?? `Send failed (${r.status})`;
        dispatch({ type: "error", payload: { message } });
        return { ok: false, error: message };
      }
      return { ok: true };
    } catch {
      const message = "Message send failed. Check server connection.";
      dispatch({ type: "error", payload: { message } });
      return { ok: false, error: message };
    }
  }, []);

  const sendApproval = useCallback(async (callId: string, decision: unknown) => {
    try {
      const r = await fetch(`${SERVER}/api/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callId, decision }),
      });
      if (r.ok) dispatch({ type: "approval_resolved" });
      else dispatch({ type: "error", payload: { message: `Approval request failed (${r.status})` } });
    } catch {
      dispatch({ type: "error", payload: { message: "Approval request failed. Check server connection." } });
    }
  }, []);

  const sendAnswer = useCallback(async (answer: string) => {
    try {
      const r = await fetch(`${SERVER}/api/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer }),
      });
      if (r.ok) dispatch({ type: "ask_user_resolved" });
      else dispatch({ type: "error", payload: { message: `Answer submit failed (${r.status})` } });
    } catch {
      dispatch({ type: "error", payload: { message: "Answer submit failed. Check server connection." } });
    }
  }, []);

  const sendClearSession = useCallback(async () => {
    const r = await fetch(`${SERVER}/api/session/reset`, { method: "POST" });
    if (r.ok) {
      dispatch({ type: "session_reset" });
      return;
    }
    let msg = `Session reset failed (${r.status})`;
    try {
      const j = (await r.json()) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      /* ignore */
    }
    dispatch({ type: "error", payload: { message: msg } });
  }, []);

  return { state, sendMessage, sendApproval, sendAnswer, sendClearSession };
}
