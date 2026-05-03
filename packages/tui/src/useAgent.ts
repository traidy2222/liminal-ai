import { useCallback, useEffect, useReducer } from "react";
import type { AgentHarness, AgentEventMap, ContextSnapshot } from "@liminal/core";

export type MessageEntry =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string; streaming: boolean }
  | {
      kind: "tool_call";
      callId: string;
      name: string;
      argsJson: string;
      status: "streaming" | "pending_approval" | "running" | "done" | "error";
    }
  | { kind: "tool_result"; callId: string; output: string; ok: boolean }
  | { kind: "ask_user"; prompt: string }
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

export interface AgentState {
  messages: MessageEntry[];
  contextSnapshot: ContextSnapshot | null;
  pendingApproval: AgentEventMap["tool_approval"] | null;
  pendingAskUser: AgentEventMap["ask_user"] | null;
  error: string | null;
  busy: boolean;
  /** Display name of the currently active persona. Default: "Liminal". */
  personaName: string;
}

type Action =
  | { type: "user_message"; text: string }
  | { type: "text_delta"; delta: string }
  | { type: "tool_start"; callId: string; name: string }
  | { type: "tool_delta"; callId: string; argsDelta: string }
  | { type: "tool_approval"; payload: AgentEventMap["tool_approval"] }
  | { type: "approval_resolved" }
  | { type: "tool_result"; callId: string; ok: boolean; output: string; name: string; args: Record<string, unknown> }
  | { type: "ask_user"; payload: AgentEventMap["ask_user"] }
  | { type: "ask_user_resolved" }
  | { type: "turn_end"; snapshot: ContextSnapshot }
  | { type: "error"; msg: string }
  | { type: "think"; content: string }
  | { type: "plan"; steps: string[] }
  | { type: "plan_step_done"; stepIndex: number }  // (#8 structured plan)
  | { type: "subtask_spawned"; taskId: string; parentTaskId: string; goal: string; depth: number }
  | { type: "subtask_complete"; taskId: string; ok: boolean }
  | { type: "context_compressed"; beforePct: number; afterPct: number; rounds: number }
  | { type: "persona_changed"; name: string };

function reducer(state: AgentState, action: Action): AgentState {
  switch (action.type) {
    case "user_message":
      return {
        ...state,
        busy: true,
        error: null,
        messages: [...state.messages, { kind: "user", text: action.text }],
      };

    case "text_delta": {
      const last = state.messages.at(-1);
      if (last?.kind === "assistant" && last.streaming) {
        const updated = { ...last, text: last.text + action.delta };
        return { ...state, messages: [...state.messages.slice(0, -1), updated] };
      }
      return {
        ...state,
        messages: [
          ...state.messages,
          { kind: "assistant", text: action.delta, streaming: true },
        ],
      };
    }

    case "tool_start":
      // Suppress generic card for think/plan — they render as special entries
      if (action.name === "think" || action.name === "plan") return state;
      // Also suppress cards for orchestration tools — they appear as subtask entries
      if (
        action.name === "spawn_agent" ||
        action.name === "wait_for_agents" ||
        action.name === "cancel_agent" ||
        action.name === "list_agents"
      )
        return state;
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            kind: "tool_call",
            callId: action.callId,
            name: action.name,
            argsJson: "",
            status: "streaming",
          },
        ],
      };

    case "tool_delta": {
      const messages = state.messages.map((m) =>
        m.kind === "tool_call" && m.callId === action.callId
          ? { ...m, argsJson: m.argsJson + action.argsDelta }
          : m
      );
      return { ...state, messages };
    }

    case "tool_approval": {
      const messages = state.messages.map((m) =>
        m.kind === "tool_call" && m.callId === action.payload.callId
          ? { ...m, status: "pending_approval" as const }
          : m
      );
      return { ...state, messages, pendingApproval: action.payload };
    }

    case "approval_resolved":
      return { ...state, pendingApproval: null };

    case "tool_result": {
      const messages = state.messages
        .map((m) =>
          m.kind === "tool_call" && m.callId === action.callId
            ? { ...m, status: action.ok ? ("done" as const) : ("error" as const) }
            : m
        )
        .concat([
          {
            kind: "tool_result",
            callId: action.callId,
            output: action.output,
            ok: action.ok,
          },
        ]);
      return { ...state, messages };
    }

    case "plan_step_done": {
      // Find the last plan entry and mark the step as done (#8)
      const msgs = [...state.messages];
      for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i]!;
        if (m.kind === "plan" && action.stepIndex < m.steps.length) {
          const updatedSteps = m.steps.map((s, j) =>
            j === action.stepIndex && !s.startsWith("✓") ? `✓ ${s}` : s
          );
          msgs[i] = { ...m, steps: updatedSteps };
          break;
        }
      }
      return { ...state, messages: msgs };
    }

    case "ask_user":
      return { ...state, pendingAskUser: action.payload };

    case "ask_user_resolved":
      return { ...state, pendingAskUser: null };

    case "turn_end": {
      const messages = state.messages.map((m) =>
        m.kind === "assistant" && m.streaming ? { ...m, streaming: false } : m
      );
      return { ...state, messages, contextSnapshot: action.snapshot, busy: false };
    }

    case "error":
      return { ...state, error: action.msg, busy: false };

    case "think":
      return {
        ...state,
        messages: [...state.messages, { kind: "think", content: action.content }],
      };

    case "plan":
      return {
        ...state,
        messages: [...state.messages, { kind: "plan", steps: action.steps }],
      };

    case "subtask_spawned":
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            kind: "subtask",
            taskId: action.taskId,
            parentTaskId: action.parentTaskId,   // (#7)
            goal: action.goal,
            depth: action.depth,
            status: "running",
          },
        ],
      };

    case "context_compressed":
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            kind: "context_compressed",
            beforePct: action.beforePct,
            afterPct: action.afterPct,
            rounds: action.rounds,
          },
        ],
      };

    case "subtask_complete":
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.kind === "subtask" && m.taskId === action.taskId
            ? { ...m, status: action.ok ? ("done" as const) : ("error" as const) }
            : m
        ),
      };

    case "persona_changed":
      return { ...state, personaName: action.name };
  }
}

const initialState: AgentState = {
  messages: [],
  contextSnapshot: null,
  pendingApproval: null,
  pendingAskUser: null,
  error: null,
  busy: false,
  personaName: "Liminal",
};

export function useAgent(harness: AgentHarness) {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    const { emitter } = harness;

    emitter.on("text", ({ delta }) => dispatch({ type: "text_delta", delta }));
    emitter.on("tool_start", ({ callId, name }) =>
      dispatch({ type: "tool_start", callId, name })
    );
    emitter.on("tool_delta", ({ callId, argsDelta }) =>
      dispatch({ type: "tool_delta", callId, argsDelta })
    );
    emitter.on("tool_approval", (payload) =>
      dispatch({ type: "tool_approval", payload })
    );
    emitter.on("tool_result", ({ callId, name, args, result }) => {
      // Intercept think/plan — render as special entries
      if (name === "think" && result.ok) {
        dispatch({ type: "think", content: args["content"] as string });
        return;
      }
      if (name === "plan" && result.ok) {
        const steps = args["steps"] as string[] | undefined;
        const stepIndex = args["step_index"] as number | undefined;
        if (steps && steps.length > 0) {
          dispatch({ type: "plan", steps });
        } else if (stepIndex !== undefined) {
          // (#8) Mark step as done in the last plan entry
          dispatch({ type: "plan_step_done", stepIndex });
        }
        return;
      }
      // Suppress results for orchestration tools (they show as subtask cards)
      if (
        name === "spawn_agent" ||
        name === "wait_for_agents" ||
        name === "cancel_agent" ||
        name === "list_agents"
      ) {
        return;
      }
      dispatch({
        type: "tool_result",
        callId,
        name,
        args,
        ok: result.ok,
        output: result.ok ? result.output : result.error,
      });
    });
    emitter.on("ask_user", (payload) =>
      dispatch({ type: "ask_user", payload })
    );
    emitter.on("turn_end", ({ contextSnapshot }) =>
      dispatch({ type: "turn_end", snapshot: contextSnapshot })
    );
    emitter.on("error", ({ err }) =>
      dispatch({ type: "error", msg: err.message })
    );
    emitter.on("subtask_spawned", ({ taskId, parentTaskId, goal, depth }) =>
      dispatch({ type: "subtask_spawned", taskId, parentTaskId, goal, depth })
    );
    emitter.on("subtask_complete", ({ taskId, ok }) =>
      dispatch({ type: "subtask_complete", taskId, ok })
    );
    // New events (#7 Structured Event Log)
    emitter.on("context_compressed", ({ beforeFraction, afterFraction, roundsCompressed }) =>
      dispatch({
        type: "context_compressed",
        beforePct: Math.round(beforeFraction * 100),
        afterPct: Math.round(afterFraction * 100),
        rounds: roundsCompressed,
      })
    );
    // Persona change — update header badge
    emitter.on("persona_changed", ({ name }) =>
      dispatch({ type: "persona_changed", name })
    );
    // ask_user_answered and approval_decision are informational — no UI state change needed
    // but they fire into the event stream for telemetry consumers
  }, [harness]);

  const sendMessage = useCallback(
    (text: string) => {
      dispatch({ type: "user_message", text });
      void harness.send(text);
    },
    [harness]
  );

  const resolveApproval = useCallback(
    (decision: import("@liminal/core").ApprovalDecision) => {
      if (state.pendingApproval) {
        state.pendingApproval.resolve(decision);
        dispatch({ type: "approval_resolved" });
      }
    },
    [state.pendingApproval]
  );

  const resolveAskUser = useCallback(
    (answer: string) => {
      if (state.pendingAskUser) {
        state.pendingAskUser.resolve(answer);
        dispatch({ type: "ask_user_resolved" });
      }
    },
    [state.pendingAskUser]
  );

  return { state, sendMessage, resolveApproval, resolveAskUser };
}
