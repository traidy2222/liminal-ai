import { useEffect, useReducer, useCallback } from "react";

export type MessageEntry =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string; streaming: boolean }
  | {
      kind: "tool_call";
      callId: string;
      name: string;
      argsJson: string;
      status: "streaming" | "pending_approval" | "done" | "error";
    }
  | { kind: "tool_result"; callId: string; output: string; ok: boolean }
  | { kind: "think"; content: string }
  | { kind: "plan"; steps: string[] }
  | {
      kind: "subtask";
      taskId: string;
      parentTaskId: string;   // (#7 — enables agent tree reconstruction)
      goal: string;
      depth: number;
      status: "running" | "done" | "error" | "cancelled";
    }
  | { kind: "context_compressed"; beforePct: number; afterPct: number; rounds: number };

interface ContextSnapshot {
  tokenCount: number;
  maxTokens: number;
  usageFraction: number;
  masked: boolean;
}

export interface SSEState {
  messages: MessageEntry[];
  contextSnapshot: ContextSnapshot | null;
  pendingApproval: { callId: string; name: string; args: Record<string, unknown> } | null;
  pendingAskUser: { prompt: string } | null;
  connected: boolean;
  busy: boolean;
  error: string | null;
  /** Display name of the currently active persona. */
  personaName: string;
}

const ORCH_TOOLS = new Set(["spawn_agent", "wait_for_agents", "cancel_agent", "list_agents"]);

type Action =
  | { type: "connected" }
  | { type: "disconnected" }
  | { type: "user_message"; text: string }
  | { type: "text"; payload: { delta: string } }
  | { type: "tool_start"; payload: { callId: string; name: string } }
  | { type: "tool_delta"; payload: { callId: string; argsDelta: string } }
  | { type: "tool_approval"; payload: { callId: string; name: string; args: Record<string, unknown> } }
  | { type: "tool_result"; payload: { callId: string; name: string; args: Record<string, unknown>; ok: boolean; output: string } }
  | { type: "ask_user"; payload: { prompt: string } }
  | { type: "approval_resolved" }
  | { type: "ask_user_resolved" }
  | { type: "turn_end"; payload: { contextSnapshot: ContextSnapshot } }
  | { type: "error"; payload: { message: string } }
  | { type: "subtask_spawned"; payload: { taskId: string; parentTaskId: string; goal: string; depth: number } }
  | { type: "subtask_complete"; payload: { taskId: string; ok: boolean } }
  | { type: "plan_step_done"; payload: { stepIndex: number } }      // (#8)
  | { type: "context_compressed"; payload: { beforeFraction: number; afterFraction: number; roundsCompressed: number } } // (#7)
  | { type: "persona_changed"; payload: { name: string } };

function reducer(state: SSEState, action: Action): SSEState {
  switch (action.type) {
    case "connected":
      return { ...state, connected: true };

    case "disconnected":
      return { ...state, connected: false };

    case "user_message":
      return {
        ...state,
        busy: true,
        error: null,
        messages: [...state.messages, { kind: "user", text: action.text }],
      };

    case "text": {
      const last = state.messages.at(-1);
      if (last?.kind === "assistant" && last.streaming) {
        return {
          ...state,
          messages: [
            ...state.messages.slice(0, -1),
            { ...last, text: last.text + action.payload.delta },
          ],
        };
      }
      return {
        ...state,
        messages: [
          ...state.messages,
          { kind: "assistant", text: action.payload.delta, streaming: true },
        ],
      };
    }

    case "tool_start": {
      const { name } = action.payload;
      // Suppress cards for think/plan/orchestration tools
      if (name === "think" || name === "plan" || ORCH_TOOLS.has(name)) return state;
      return {
        ...state,
        messages: [
          ...state.messages,
          { kind: "tool_call", callId: action.payload.callId, name, argsJson: "", status: "streaming" },
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
        pendingApproval: action.payload,
        messages: state.messages.map((m) =>
          m.kind === "tool_call" && m.callId === action.payload.callId
            ? { ...m, status: "pending_approval" as const }
            : m
        ),
      };

    case "approval_resolved":
      return { ...state, pendingApproval: null };

    case "tool_result": {
      const { callId, name, args, ok, output } = action.payload;
      // Intercept think/plan
      if (name === "think" && ok) {
        return {
          ...state,
          messages: [...state.messages, { kind: "think", content: args["content"] as string }],
        };
      }
      if (name === "plan" && ok) {
        return {
          ...state,
          messages: [...state.messages, { kind: "plan", steps: args["steps"] as string[] }],
        };
      }
      // Suppress orchestration tool results (they show as subtask cards)
      if (ORCH_TOOLS.has(name)) return state;

      return {
        ...state,
        messages: state.messages
          .map((m) =>
            m.kind === "tool_call" && m.callId === callId
              ? { ...m, status: ok ? ("done" as const) : ("error" as const) }
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
        messages: state.messages.map((m) =>
          m.kind === "assistant" && m.streaming ? { ...m, streaming: false } : m
        ),
      };

    case "error":
      return { ...state, busy: false, error: action.payload.message };

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
          },
        ],
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
  });

  useEffect(() => {
    const es = new EventSource(`${SERVER}/api/stream`);

    es.addEventListener("connected", () => dispatch({ type: "connected" }));
    es.addEventListener("text", (e: MessageEvent) =>
      dispatch({ type: "text", payload: JSON.parse(e.data) })
    );
    es.addEventListener("tool_start", (e: MessageEvent) =>
      dispatch({ type: "tool_start", payload: JSON.parse(e.data) })
    );
    es.addEventListener("tool_delta", (e: MessageEvent) =>
      dispatch({ type: "tool_delta", payload: JSON.parse(e.data) })
    );
    es.addEventListener("tool_approval", (e: MessageEvent) =>
      dispatch({ type: "tool_approval", payload: JSON.parse(e.data) })
    );
    es.addEventListener("tool_result", (e: MessageEvent) =>
      dispatch({ type: "tool_result", payload: JSON.parse(e.data) })
    );
    es.addEventListener("ask_user", (e: MessageEvent) =>
      dispatch({ type: "ask_user", payload: JSON.parse(e.data) })
    );
    es.addEventListener("turn_end", (e: MessageEvent) =>
      dispatch({ type: "turn_end", payload: JSON.parse(e.data) })
    );
    es.addEventListener("subtask_spawned", (e: MessageEvent) =>
      dispatch({ type: "subtask_spawned", payload: JSON.parse(e.data) })
    );
    es.addEventListener("subtask_complete", (e: MessageEvent) =>
      dispatch({ type: "subtask_complete", payload: JSON.parse(e.data) })
    );
    es.addEventListener("plan_step_done", (e: MessageEvent) =>
      dispatch({ type: "plan_step_done", payload: JSON.parse(e.data) })
    );
    es.addEventListener("context_compressed", (e: MessageEvent) =>
      dispatch({ type: "context_compressed", payload: JSON.parse(e.data) })
    );
    // Persona change — update header badge
    es.addEventListener("persona_changed", (e: MessageEvent) =>
      dispatch({ type: "persona_changed", payload: JSON.parse(e.data) })
    );
    // Informational-only events — no UI state change needed
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

    return () => es.close();
  }, []);

  const sendMessage = useCallback(async (message: string) => {
    dispatch({ type: "user_message", text: message });
    await fetch(`${SERVER}/api/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
  }, []);

  const sendApproval = useCallback(async (callId: string, decision: unknown) => {
    await fetch(`${SERVER}/api/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callId, decision }),
    });
    dispatch({ type: "approval_resolved" });
  }, []);

  const sendAnswer = useCallback(async (answer: string) => {
    await fetch(`${SERVER}/api/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer }),
    });
    dispatch({ type: "ask_user_resolved" });
  }, []);

  return { state, sendMessage, sendApproval, sendAnswer };
}
