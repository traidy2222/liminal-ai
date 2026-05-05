import { useCallback, useEffect, useReducer, useRef } from "react";
import type { AgentHarness, AgentEventMap, ContextSnapshot } from "@liminal/core";

function isAgentUiQuiet(): boolean {
  return process.env["AGENT_UI_VERBOSITY"]?.trim() === "quiet";
}

function sanitizeDeltaText(text: string): string {
  return text
    .replace(/\uFFFD/g, "")
    .replace(/([A-Za-z])⚙([A-Za-z])/g, "$1$2")
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
    }
  | { kind: "tool_result"; callId: string; output: string; ok: boolean }
  | { kind: "ask_user"; prompt: string }
  | { kind: "think"; content: string }
  | { kind: "plan"; steps: string[] }
  | { kind: "trace"; text: string }
  | {
      kind: "subtask";
      taskId: string;
      parentTaskId: string;   // (#7 — enables agent tree reconstruction)
      goal: string;
      depth: number;
      status: "running" | "done" | "error" | "cancelled";
      partialOutput: string;
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
  | { type: "trace_delta"; delta: string }
  | {
      type: "provider_retry";
      attempt: number;
      maxAttempts: number;
      message: string;
      backoffMs: number;
    }
  | { type: "session_reset" }
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
  | { type: "subtask_output"; taskId: string; delta: string }
  | { type: "context_compressed"; beforePct: number; afterPct: number; rounds: number }
  | { type: "persona_changed"; name: string };

function stripTrailingProviderRetry(messages: MessageEntry[]): MessageEntry[] {
  const last = messages.at(-1);
  if (last?.kind === "provider_retry") return messages.slice(0, -1);
  return messages;
}

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
      const baseMessages = stripTrailingProviderRetry(state.messages);
      const last = baseMessages.at(-1);
      if (last?.kind === "assistant" && last.streaming) {
        const updated = { ...last, text: last.text + action.delta };
        return { ...state, messages: [...baseMessages.slice(0, -1), updated] };
      }
      return {
        ...state,
        messages: [
          ...baseMessages,
          { kind: "assistant", text: action.delta, streaming: true },
        ],
      };
    }

    case "trace_delta": {
      const lastT = state.messages.at(-1);
      if (lastT?.kind === "trace") {
        return {
          ...state,
          messages: [
            ...state.messages.slice(0, -1),
            { kind: "trace", text: lastT.text + action.delta },
          ],
        };
      }
      return {
        ...state,
        messages: [...state.messages, { kind: "trace", text: action.delta }],
      };
    }

    case "provider_retry": {
      if (isAgentUiQuiet()) return state;
      const line =
        `⟳ Provider retry ${action.attempt}/${action.maxAttempts} in ${Math.round(action.backoffMs / 1000)}s: ` +
        `${action.message.slice(0, 220)}`;
      const last = state.messages.at(-1);
      if (last?.kind === "provider_retry") {
        return {
          ...state,
          messages: [...state.messages.slice(0, -1), { kind: "provider_retry", text: line }],
        };
      }
      return { ...state, messages: [...state.messages, { kind: "provider_retry", text: line }] };
    }

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
        messages: stripTrailingProviderRetry(state.messages).concat([
          {
            kind: "tool_call",
            callId: action.callId,
            name: action.name,
            argsJson: "",
            status: "streaming",
          },
        ]),
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
      const baseMessages = stripTrailingProviderRetry(state.messages);
      return { ...state, messages: baseMessages
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
        ]) };
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
      const messages = stripTrailingProviderRetry(state.messages).map((m) =>
        m.kind === "assistant" && m.streaming ? { ...m, streaming: false } : m
      );
      return { ...state, messages, contextSnapshot: action.snapshot, busy: false };
    }

    case "error":
      return { ...state, error: action.msg, busy: false, messages: stripTrailingProviderRetry(state.messages) };

    case "think":
      if (isAgentUiQuiet()) return state;
      return {
        ...state,
        messages: [...state.messages, { kind: "think", content: action.content }],
      };

    case "plan":
      if (isAgentUiQuiet()) return state;
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
            partialOutput: "",
          },
        ],
      };

    case "subtask_output":
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.kind === "subtask" && m.taskId === action.taskId
            ? { ...m, partialOutput: m.partialOutput + action.delta }
            : m
        ),
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
  const queuedTextRef = useRef("");
  const queuedTraceRef = useRef("");
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const { emitter } = harness;
    const flush = () => {
      flushTimerRef.current = null;
      if (queuedTextRef.current) {
        dispatch({ type: "text_delta", delta: queuedTextRef.current });
        queuedTextRef.current = "";
      }
      if (queuedTraceRef.current) {
        dispatch({ type: "trace_delta", delta: queuedTraceRef.current });
        queuedTraceRef.current = "";
      }
    };
    const queueFlush = () => {
      if (flushTimerRef.current) return;
      flushTimerRef.current = setTimeout(flush, 40);
    };
    const flushNow = () => {
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      flush();
    };

    emitter.on("text", ({ delta, channel }) => {
      const ch = channel ?? "user";
      if (isAgentUiQuiet() && ch === "trace") return;
      const cleaned = sanitizeDeltaText(delta);
      if (ch === "trace") {
        queuedTraceRef.current += cleaned;
        queueFlush();
        return;
      }
      queuedTextRef.current += cleaned;
      queueFlush();
    });
    emitter.on("provider_retry", (p) =>
      dispatch({
        type: "provider_retry",
        attempt: p.attempt,
        maxAttempts: p.maxAttempts,
        message: p.message,
        backoffMs: p.backoffMs,
      })
    );
    emitter.on("tool_start", ({ callId, name }) => {
      flushNow();
      dispatch({ type: "tool_start", callId, name });
    });
    emitter.on("tool_delta", ({ callId, argsDelta }) => {
      flushNow();
      dispatch({ type: "tool_delta", callId, argsDelta });
    });
    emitter.on("tool_approval", (payload) => {
      flushNow();
      dispatch({ type: "tool_approval", payload });
    });
    emitter.on("tool_result", ({ callId, name, args, result }) => {
      flushNow();
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
    emitter.on("ask_user", (payload) => {
      flushNow();
      dispatch({ type: "ask_user", payload });
    });
    emitter.on("turn_end", ({ contextSnapshot }) => {
      flushNow();
      dispatch({ type: "turn_end", snapshot: contextSnapshot });
    });
    emitter.on("error", ({ err }) => {
      flushNow();
      dispatch({ type: "error", msg: err.message });
    });
    emitter.on("subtask_spawned", ({ taskId, parentTaskId, goal, depth }) => {
      flushNow();
      dispatch({ type: "subtask_spawned", taskId, parentTaskId, goal, depth });
    });
    emitter.on("subtask_complete", ({ taskId, ok }) => {
      flushNow();
      dispatch({ type: "subtask_complete", taskId, ok });
    });
    emitter.on("subtask_output", ({ taskId, delta }) => {
      flushNow();
      dispatch({ type: "subtask_output", taskId, delta });
    });
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
    emitter.on("execution_state", (p) =>
      dispatch({
        type: "trace_delta",
        delta:
          `\n[runtime] mission=${p.missionId ?? "n/a"} contract=${p.activeContractId ?? "n/a"} ` +
          `drift=${p.driftScore.toFixed(2)} milestones=${p.milestoneCount} contracts=${p.contractCount}\n`,
      })
    );
    emitter.on("contract_transition", (p) =>
      dispatch({
        type: "trace_delta",
        delta: `\n[contract] ${p.contractId} -> ${p.status}${p.reason ? ` (${p.reason})` : ""}\n`,
      })
    );
    emitter.on("contract_violation", (p) =>
      dispatch({
        type: "trace_delta",
        delta: `\n[contract violation] ${p.toolName}: ${p.reason}\n`,
      })
    );
    emitter.on("recovery_action", (p) =>
      dispatch({
        type: "trace_delta",
        delta: `\n[recovery] ${p.strategy}: ${p.reason}${p.notes ? ` (${p.notes})` : ""}\n`,
      })
    );
    emitter.on("drift_detected", (p) =>
      dispatch({
        type: "trace_delta",
        delta: `\n[drift] score=${p.score.toFixed(2)} replan=${p.triggeredReplan ? "yes" : "no"} (${p.reason})\n`,
      })
    );
    emitter.on("runtime_heartbeat", (p) =>
      dispatch({
        type: "trace_delta",
        delta: `\n[heartbeat] round=${p.round} uptime_ms=${p.uptimeMs} drift=${p.driftScore.toFixed(2)}\n`,
      })
    );
    emitter.on("vault_activity", (p) =>
      dispatch({
        type: "trace_delta",
        delta:
          `\n[vault] action=${p.action} ok=${p.ok ? "yes" : "no"}` +
          `${p.noteTitle ? ` title="${p.noteTitle}"` : ""}` +
          `${p.reason ? ` reason="${p.reason}"` : ""}\n`,
      })
    );
    emitter.on("runtime_pref_detected", (p) =>
      dispatch({
        type: "trace_delta",
        delta: `\n[prefs] detected risky=${p.risky ? "yes" : "no"} ${p.summary}\n`,
      })
    );
    emitter.on("runtime_pref_changed", (p) =>
      dispatch({
        type: "trace_delta",
        delta: `\n[prefs] changed persisted=${p.persisted ? "yes" : "no"} ${p.summary}\n`,
      })
    );
    emitter.on("runtime_pref_persisted", (p) =>
      dispatch({
        type: "trace_delta",
        delta: `\n[prefs] persisted path=${p.path}\n`,
      })
    );
    emitter.on("runtime_pref_rejected", (p) =>
      dispatch({
        type: "trace_delta",
        delta: `\n[prefs] rejected ${p.summary} (${p.reason})\n`,
      })
    );
    // ask_user_answered and approval_decision are informational — no UI state change needed
    // but they fire into the event stream for telemetry consumers
    return () => {
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      flushNow();
    };
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

  const dismissApprovalUi = useCallback(() => {
    dispatch({ type: "approval_resolved" });
  }, []);

  const clearSession = useCallback(() => {
    if (harness.getIsRunning()) return;
    if (state.pendingApproval || state.pendingAskUser) return;
    harness.clearConversation();
    dispatch({ type: "session_reset" });
  }, [harness, state.pendingApproval, state.pendingAskUser]);

  const resolveAskUser = useCallback(
    (answer: string) => {
      if (state.pendingAskUser) {
        state.pendingAskUser.resolve(answer);
        dispatch({ type: "ask_user_resolved" });
      }
    },
    [state.pendingAskUser]
  );

  const dismissAskUserUi = useCallback(() => {
    dispatch({ type: "ask_user_resolved" });
  }, []);

  return {
    state,
    sendMessage,
    resolveApproval,
    resolveAskUser,
    dismissApprovalUi,
    dismissAskUserUi,
    clearSession,
  };
}
