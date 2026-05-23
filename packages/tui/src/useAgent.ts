import { useCallback, useEffect, useReducer, useRef } from "react";
import {
  buildMessageWithImageAttachments,
  type AgentEventMap,
  type AgentHarness,
  type ContextSnapshot,
  type ImageAttachment,
  resolveHarnessEnvRaw,
} from "@liminal/core";
import type { PersonaArtifactPreview } from "@liminal/core/persona-bootstrap-progress";
import {
  extractStreamingWritePreview,
  isStreamingWriteTool,
} from "@liminal/core/streaming-write-preview";
import {
  applyPersonaProfileToHarness,
  clearPersistedPersonaArtifacts,
  generatePersonaFromInput,
  isResetToDefaultRequest,
  parsePersonaInput,
} from "@liminal/tools";
import type { AutoDreamState } from "./autoDreamPresent.js";

function isAgentUiQuiet(): boolean {
  return process.env["AGENT_UI_VERBOSITY"]?.trim() === "quiet";
}

function isDiagnosticsEnabled(): boolean {
  return process.env["AGENT_UI_DIAGNOSTICS"]?.trim() === "1";
}

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
  | { kind: "ask_user"; prompt: string }
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
  | { kind: "plan"; steps: string[]; callId?: string; streaming?: boolean; argsJson?: string; previewText?: string }
  | { kind: "model_reasoning"; text: string; streaming: boolean }
  | { kind: "trace"; text: string }
  | { kind: "pulse_nudge"; text: string }
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
    };

export interface AgentState {
  messages: MessageEntry[];
  contextSnapshot: ContextSnapshot | null;
  pendingApproval: AgentEventMap["tool_approval"] | null;
  pendingAskUser: AgentEventMap["ask_user"] | null;
  error: string | null;
  busy: boolean;
  personaName: string;
  autoDream: AutoDreamState;
  personaBootstrapPending: boolean;
  personaBootstrapAllowSkip: boolean;
  personaBootstrapProgress: string | null;
  personaBootstrapStage: string | null;
  personaBootstrapArtifacts: PersonaArtifactPreview[] | null;
  personaBootstrapSubmitting: boolean;
  /** Ambient line for AGENT_HEARTBEAT (footer / status strip). */
  personalityPulseLine: string | null;
  personalityPulseActive: boolean;
}

export function computePersonaBootstrapPending(harness: AgentHarness): boolean {
  const prefs = harness.getRuntimePreferences();
  if (resolveHarnessEnvRaw("AGENT_PERSONA_BOOTSTRAP", prefs) === "0") return false;
  if (process.env["AGENT_PERSONA_BOOTSTRAP_FORCE"] === "1") return true;
  return !harness.isPersonaBootstrapCompleted();
}

function personaBootstrapAllowSkipFromHarness(harness: AgentHarness): boolean {
  return resolveHarnessEnvRaw("AGENT_PERSONA_BOOTSTRAP_ALLOW_SKIP", harness.getRuntimePreferences()) !== "0";
}

type Action =
  | { type: "user_message"; text: string }
  | { type: "text_delta"; delta: string }
  | { type: "trace_delta"; delta: string }
  | { type: "model_reasoning_delta"; delta: string }
  | {
      type: "provider_retry";
      attempt: number;
      maxAttempts: number;
      message: string;
      backoffMs: number;
    }
  | {
      type: "session_reset";
      personaBootstrap?: { pending: boolean; allowSkip: boolean };
    }
  | { type: "tool_start"; callId: string; name: string }
  | { type: "tool_delta"; callId: string; argsDelta: string }
  | { type: "tool_approval"; payload: AgentEventMap["tool_approval"] }
  | { type: "approval_resolved" }
  | { type: "tool_result"; callId: string; ok: boolean; output: string; name: string; args: Record<string, unknown> }
  | { type: "ask_user"; payload: AgentEventMap["ask_user"] }
  | { type: "ask_user_resolved" }
  | { type: "turn_end"; snapshot: ContextSnapshot; harnessMetrics?: AgentEventMap["turn_end"]["harnessMetrics"] }
  | {
      type: "turn_summary";
      payload: AgentEventMap["turn_summary"];
    }
  | { type: "tool_timing"; callId: string; durationMs: number }
  | { type: "error"; msg: string }
  | {
      type: "think";
      callId: string;
      content: string;
      tool_families?: string[];
      scope?: string;
      unknowns?: string[];
      clarification_needed?: boolean;
      clarification_question?: string;
      self_check?: number;
    }
  | {
      type: "reason";
      callId: string;
      inference: string;
      confidence?: "low" | "medium" | "high";
      next_action?: string;
    }
  | { type: "plan"; steps: string[] }
  | { type: "plan_step_done"; stepIndex: number }
  | { type: "subtask_spawned"; taskId: string; parentTaskId: string; goal: string; depth: number }
  | { type: "subtask_complete"; taskId: string; ok: boolean }
  | { type: "subtask_output"; taskId: string; delta: string }
  | { type: "context_compressed"; beforePct: number; afterPct: number; rounds: number }
  | { type: "persona_changed"; name: string }
  | { type: "auto_dream"; payload: AgentEventMap["auto_dream"] }
  | { type: "heartbeat_started"; payload: AgentEventMap["heartbeat_started"] }
  | { type: "heartbeat_completed"; payload: AgentEventMap["heartbeat_completed"] }
  | { type: "heartbeat_skipped"; payload: AgentEventMap["heartbeat_skipped"] }
  | {
      type: "persona_bootstrap_progress";
      message: string | null;
      stage: string | null;
      artifacts?: PersonaArtifactPreview[] | null;
    }
  | { type: "persona_bootstrap_submitting"; value: boolean }
  | { type: "persona_bootstrap_done" };

function createInitialAgentState(harness: AgentHarness): AgentState {
  return {
    messages: [],
    contextSnapshot: null,
    pendingApproval: null,
    pendingAskUser: null,
    error: null,
    busy: false,
    personaName: "Liminal",
    autoDream: { stage: "idle", updatedAt: Date.now() },
    personaBootstrapPending: computePersonaBootstrapPending(harness),
    personaBootstrapAllowSkip: personaBootstrapAllowSkipFromHarness(harness),
    personaBootstrapProgress: null,
    personaBootstrapStage: null,
    personaBootstrapArtifacts: null,
    personaBootstrapSubmitting: false,
    personalityPulseLine: null,
    personalityPulseActive: false,
  };
}

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
        personalityPulseActive: false,
        messages: [...state.messages, { kind: "user", text: action.text }],
      };

    case "text_delta": {
      const baseMessages = finalizeStreamingModelReasoning(
        stripTrailingProviderRetry(state.messages)
      );
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
      if (!isDiagnosticsEnabled()) return state;
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

    case "model_reasoning_delta": {
      let baseMessages = stripTrailingProviderRetry(state.messages);
      if (/reasoning budget restart/i.test(action.delta)) {
        baseMessages = finalizeStreamingModelReasoning(baseMessages);
      }
      const last = baseMessages.at(-1);
      if (last?.kind === "model_reasoning" && last.streaming) {
        return {
          ...state,
          messages: [
            ...baseMessages.slice(0, -1),
            { ...last, text: last.text + action.delta },
          ],
        };
      }
      return {
        ...state,
        messages: [
          ...baseMessages,
          { kind: "model_reasoning", text: action.delta, streaming: true },
        ],
      };
    }

    case "provider_retry": {
      if (!isDiagnosticsEnabled()) return state;
      const maxLabel = action.maxAttempts > 0 ? String(action.maxAttempts) : "∞";
      const line =
        `⟳ Provider retry ${action.attempt}/${maxLabel} in ${Math.round(action.backoffMs / 1000)}s: ` +
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

    case "session_reset": {
      const pb = action.personaBootstrap;
      return {
        ...state,
        messages: [],
        busy: false,
        error: null,
        contextSnapshot: null,
        pendingApproval: null,
        pendingAskUser: null,
        autoDream: { stage: "idle", updatedAt: Date.now() },
        personalityPulseLine: null,
        personalityPulseActive: false,
        ...(pb
          ? {
              personaBootstrapPending: pb.pending,
              personaBootstrapAllowSkip: pb.allowSkip,
              personaBootstrapProgress: null,
              personaBootstrapStage: null,
              personaBootstrapSubmitting: false,
            }
          : {}),
      };
    }

    case "tool_start": {
      const baseAfterReasoning = finalizeStreamingModelReasoning(
        stripTrailingProviderRetry(state.messages)
      );
      if (action.name === "think") {
        return {
          ...state,
          messages: baseAfterReasoning.concat([
            { kind: "think", callId: action.callId, streaming: true, argsJson: "", content: "" },
          ]),
        };
      }
      if (action.name === "reason") {
        return {
          ...state,
          messages: baseAfterReasoning.concat([
            { kind: "reason", callId: action.callId, streaming: true, argsJson: "", inference: "" },
          ]),
        };
      }
      if (action.name === "plan") {
        return {
          ...state,
          messages: baseAfterReasoning.concat([
            { kind: "plan", callId: action.callId, streaming: true, argsJson: "", steps: [], previewText: "" },
          ]),
        };
      }
      // Suppress orchestration tools — they appear as subtask entries
      if (
        action.name === "spawn_agent" ||
        action.name === "wait_for_agents" ||
        action.name === "cancel_agent" ||
        action.name === "list_agents"
      ) return state;
      const duplicate = baseAfterReasoning.some(
        (m) => m.kind === "tool_call" && m.callId === action.callId
      );
      if (duplicate) return state;
      return {
        ...state,
        messages: baseAfterReasoning.concat([
          {
            kind: "tool_call",
            callId: action.callId,
            name: action.name,
            argsJson: "",
            status: "streaming",
            startedAt: Date.now(),
          },
        ]),
      };
    }

    case "tool_delta": {
      const { callId, argsDelta } = action;
      const think = state.messages.find(
        (m): m is Extract<MessageEntry, { kind: "think" }> =>
          m.kind === "think" && m.streaming === true && m.callId === callId
      );
      if (think) {
        const argsJson = (think.argsJson ?? "") + argsDelta;
        const preview = extractStreamingWritePreview("think", argsJson);
        return {
          ...state,
          messages: state.messages.map((m) =>
            m.kind === "think" && m.callId === callId
              ? { ...m, argsJson, content: preview?.content ?? m.content }
              : m
          ),
        };
      }
      const reasonEntry = state.messages.find(
        (m): m is Extract<MessageEntry, { kind: "reason" }> =>
          m.kind === "reason" && m.streaming === true && m.callId === callId
      );
      if (reasonEntry) {
        const argsJson = (reasonEntry.argsJson ?? "") + argsDelta;
        const preview = extractStreamingWritePreview("reason", argsJson);
        return {
          ...state,
          messages: state.messages.map((m) =>
            m.kind === "reason" && m.callId === callId
              ? { ...m, argsJson, inference: preview?.content ?? m.inference }
              : m
          ),
        };
      }
      const messages = state.messages.map((m) => {
        if (m.kind !== "tool_call" || m.callId !== callId) return m;
        return promoteWriteToolCallIfArgsComplete(m, m.argsJson + argsDelta);
      });
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

    case "approval_resolved": {
      // Transition the pending tool_call to "running" once the user approves
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
      const baseMessages = stripTrailingProviderRetry(state.messages);
      const endedAt = Date.now();
      return {
        ...state,
        messages: baseMessages
          .map((m) =>
            m.kind === "tool_call" && m.callId === action.callId
              ? { ...m, status: action.ok ? ("done" as const) : ("error" as const), endedAt }
              : m
          )
          .concat([
            {
              kind: "tool_result",
              callId: action.callId,
              output: action.output,
              ok: action.ok,
            },
          ]),
      };
    }

    case "plan_step_done": {
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
      const messages = stripTrailingProviderRetry(state.messages).map((m) => {
        if (m.kind === "assistant" && m.streaming) return { ...m, streaming: false };
        if (m.kind === "model_reasoning" && m.streaming) return { ...m, streaming: false };
        if (m.kind === "think" && m.streaming) {
          return {
            ...m,
            streaming: false,
            content: m.content.trim() ? m.content : "(reasoning interrupted)",
          };
        }
        if (m.kind === "reason" && m.streaming) {
          return { ...m, streaming: false };
        }
        return m;
      });
      return { ...state, messages, contextSnapshot: action.snapshot, busy: false };
    }

    case "turn_summary":
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            kind: "turn_header" as const,
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
          m.kind === "tool_call" && m.callId === action.callId
            ? { ...m, endedAt: m.startedAt + action.durationMs }
            : m
        ),
      };

    case "error":
      return { ...state, error: action.msg, busy: false, messages: stripTrailingProviderRetry(state.messages) };

    case "think": {
      if (isAgentUiQuiet()) return state;
      const finalized = {
        kind: "think" as const,
        callId: action.callId,
        streaming: false as const,
        content: action.content,
        tool_families: action.tool_families,
        scope: action.scope,
        unknowns: action.unknowns,
        clarification_needed: action.clarification_needed,
        clarification_question: action.clarification_question,
        self_check: action.self_check,
      };
      const withoutStreaming = state.messages.filter(
        (m) => !(m.kind === "think" && m.streaming && m.callId === action.callId)
      );
      return { ...state, messages: [...withoutStreaming, finalized] };
    }

    case "reason": {
      if (isAgentUiQuiet()) return state;
      const finalizedReason = {
        kind: "reason" as const,
        callId: action.callId,
        streaming: false as const,
        inference: action.inference,
        confidence: action.confidence,
        next_action: action.next_action,
      };
      const withoutStreamingReason = state.messages.filter(
        (m) => !(m.kind === "reason" && m.streaming && m.callId === action.callId)
      );
      return { ...state, messages: [...withoutStreamingReason, finalizedReason] };
    }

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
            parentTaskId: action.parentTaskId,
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

    case "persona_bootstrap_progress":
      return {
        ...state,
        personaBootstrapProgress: action.message,
        personaBootstrapStage: action.stage,
        personaBootstrapArtifacts:
          action.artifacts !== undefined ? action.artifacts : state.personaBootstrapArtifacts,
      };

    case "persona_bootstrap_submitting":
      return { ...state, personaBootstrapSubmitting: action.value };

    case "persona_bootstrap_done":
      return {
        ...state,
        personaBootstrapPending: false,
        personaBootstrapProgress: null,
        personaBootstrapStage: null,
        personaBootstrapArtifacts: null,
        personaBootstrapSubmitting: false,
      };

    case "auto_dream": {
      const p = action.payload;
      return {
        ...state,
        autoDream: {
          stage: p.stage,
          runId: p.runId,
          gate: p.gate,
          progress: p.progress,
          result: p.result,
          error: p.error,
          updatedAt: Date.now(),
        },
      };
    }

    case "heartbeat_started":
      return {
        ...state,
        personalityPulseActive: true,
        personalityPulseLine: "Pulse · syncing…",
      };

    case "heartbeat_completed": {
      const p = action.payload;
      const msgs = [...state.messages];
      if (p.surfaceDecision === "assistant" && p.nudgeText) {
        msgs.push({ kind: "pulse_nudge", text: p.nudgeText });
      }
      return {
        ...state,
        personalityPulseActive: false,
        personalityPulseLine: p.summary.slice(0, 120),
        messages: msgs,
      };
    }

    case "heartbeat_skipped":
      return {
        ...state,
        personalityPulseActive: false,
        personalityPulseLine: `Pulse · skipped (${action.payload.reason})`,
      };

    default:
      return state;
  }
}

export function useAgent(harness: AgentHarness) {
  const [state, dispatch] = useReducer(reducer, harness, createInitialAgentState);
  const queuedTextRef = useRef("");
  const queuedTraceRef = useRef("");
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bootstrapPendingRef = useRef(computePersonaBootstrapPending(harness));
  const bootstrapInFlightRef = useRef(false);

  useEffect(() => {
    bootstrapPendingRef.current = state.personaBootstrapPending;
  }, [state.personaBootstrapPending]);

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
      if (ch === "reasoning") {
        flushNow();
        dispatch({ type: "model_reasoning_delta", delta: cleaned });
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
      if (name === "think" && result.ok) {
        dispatch({
          type: "think",
          callId,
          content: args["content"] as string,
          tool_families: args["tool_families"] as string[] | undefined,
          scope: args["scope"] as string | undefined,
          unknowns: args["unknowns"] as string[] | undefined,
          clarification_needed: args["clarification_needed"] as boolean | undefined,
          clarification_question: args["clarification_question"] as string | undefined,
          self_check: args["self_check"] as number | undefined,
        });
        return;
      }
      if (name === "reason" && result.ok) {
        dispatch({
          type: "reason",
          callId,
          inference: args["inference"] as string,
          confidence: args["confidence"] as "low" | "medium" | "high" | undefined,
          next_action: args["next_action"] as string | undefined,
        });
        return;
      }
      if (name === "plan" && result.ok) {
        const steps = args["steps"] as string[] | undefined;
        const stepIndex = args["step_index"] as number | undefined;
        if (steps && steps.length > 0) {
          dispatch({ type: "plan", steps });
        } else if (stepIndex !== undefined) {
          dispatch({ type: "plan_step_done", stepIndex });
        }
        return;
      }
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
    emitter.on("turn_summary", (payload) => {
      flushNow();
      dispatch({ type: "turn_summary", payload });
    });
    emitter.on("tool_timing", ({ callId, durationMs }) => {
      dispatch({ type: "tool_timing", callId, durationMs });
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
    emitter.on("context_compressed", ({ beforeFraction, afterFraction, roundsCompressed }) =>
      dispatch({
        type: "context_compressed",
        beforePct: Math.round(beforeFraction * 100),
        afterPct: Math.round(afterFraction * 100),
        rounds: roundsCompressed,
      })
    );
    emitter.on("persona_changed", ({ name }) =>
      dispatch({ type: "persona_changed", name })
    );
    emitter.on("auto_dream", (payload) => {
      dispatch({ type: "auto_dream", payload });
    });
    emitter.on("heartbeat_started", (payload) => {
      dispatch({ type: "heartbeat_started", payload });
    });
    emitter.on("heartbeat_completed", (payload) => {
      dispatch({ type: "heartbeat_completed", payload });
    });
    emitter.on("heartbeat_skipped", (payload) => {
      dispatch({ type: "heartbeat_skipped", payload });
    });
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
    emitter.on("runtime_pref_changed", (raw) => {
      const p = raw as {
        summary: string;
        persisted: boolean;
        personaControls?: Record<string, unknown>;
      };
      const controls = p.personaControls
        ? ` controls=[${Object.entries(p.personaControls)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => `${k}=${String(v)}`)
            .join(", ")}]`
        : "";
      dispatch({
        type: "trace_delta",
        delta: `\n[prefs] changed persisted=${p.persisted ? "yes" : "no"} ${p.summary}${controls}\n`,
      });
    });
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
    return () => {
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      flushNow();
    };
  }, [harness]);

  const submitPersonaBootstrap = useCallback(
    async (text: string, options?: { skip?: boolean }) => {
      if (!bootstrapPendingRef.current) {
        throw new Error("Persona bootstrap is not pending.");
      }
      if (bootstrapInFlightRef.current) {
        throw new Error("Persona bootstrap is already in progress.");
      }
      bootstrapInFlightRef.current = true;
      dispatch({ type: "persona_bootstrap_submitting", value: true });
      dispatch({
        type: "persona_bootstrap_progress",
        message: "Starting…",
        stage: "starting",
      });
      try {
        if (options?.skip) {
          dispatch({ type: "persona_bootstrap_progress", message: "Skipping…", stage: "skip" });
          await clearPersistedPersonaArtifacts().catch(() => undefined);
          await harness.patchRuntimePreferences(
            {
              persona: {
                bootstrapCompleted: true,
                sourcePrompt: "",
                activeProfile: null,
                updatedAt: Date.now(),
              },
            },
            { persist: true }
          );
          await harness.sendSessionGreeting();
          bootstrapPendingRef.current = false;
          dispatch({ type: "persona_bootstrap_done" });
          return;
        }
        const trimmed = text.trim();
        const skipAllowed = personaBootstrapAllowSkipFromHarness(harness);
        if (skipAllowed && /^(skip|\/skip)$/i.test(trimmed)) {
          await clearPersistedPersonaArtifacts().catch(() => undefined);
          await harness.patchRuntimePreferences(
            {
              persona: {
                bootstrapCompleted: true,
                sourcePrompt: "",
                activeProfile: null,
                updatedAt: Date.now(),
              },
            },
            { persist: true }
          );
          await harness.sendSessionGreeting();
          bootstrapPendingRef.current = false;
          dispatch({ type: "persona_bootstrap_done" });
          return;
        }
        const parsed = parsePersonaInput(trimmed);
        if (!parsed.coreInput) {
          throw new Error("Describe how you want the assistant to sound first.");
        }
        if (isResetToDefaultRequest(parsed.coreInput)) {
          harness.resetPersona();
          await clearPersistedPersonaArtifacts().catch(() => undefined);
          await harness.patchRuntimePreferences(
            {
              persona: {
                bootstrapCompleted: true,
                sourcePrompt: "default",
                activeProfile: null,
                updatedAt: Date.now(),
              },
            },
            { persist: true }
          );
          await harness.sendSessionGreeting();
          bootstrapPendingRef.current = false;
          dispatch({ type: "persona_bootstrap_done" });
          return;
        }
        const onProgress = (stage: string, message: string, detail?: { artifacts?: PersonaArtifactPreview[] }) => {
          dispatch({
            type: "persona_bootstrap_progress",
            message,
            stage,
            ...(detail?.artifacts ? { artifacts: detail.artifacts } : {}),
          });
        };
        const bundle = await generatePersonaFromInput(
          harness,
          parsed.coreInput,
          parsed.strength,
          parsed.modifier,
          onProgress
        );
        const profile = bundle.profile;
        await applyPersonaProfileToHarness(harness, profile);
        await harness.patchRuntimePreferences(
          {
            persona: {
              bootstrapCompleted: true,
              sourcePrompt: parsed.coreInput,
              activeProfile: profile,
              controls: bundle.defaultControls,
              updatedAt: Date.now(),
            },
          },
          { persist: true }
        );
        await harness.sendSessionGreeting();
        bootstrapPendingRef.current = false;
        dispatch({ type: "persona_bootstrap_done" });
      } catch (err) {
        dispatch({
          type: "error",
          msg: err instanceof Error ? err.message : String(err),
        });
      } finally {
        bootstrapInFlightRef.current = false;
        dispatch({ type: "persona_bootstrap_submitting", value: false });
        dispatch({
          type: "persona_bootstrap_progress",
          message: null,
          stage: null,
          artifacts: null,
        });
      }
    },
    [harness]
  );

  const sendMessage = useCallback(
    (text: string, attachments: ImageAttachment[] = []) => {
      if (bootstrapPendingRef.current) {
        dispatch({
          type: "error",
          msg: "Finish personality setup in the bootstrap panel first.",
        });
        return;
      }
      const userText =
        attachments.length > 0
          ? `${text.trim() || "(no text)"}\n[attached images: ${attachments.length}]`
          : text;
      dispatch({ type: "user_message", text: userText });
      void (async () => {
        try {
          await harness.send(buildMessageWithImageAttachments(text, attachments));
        } catch (err) {
          dispatch({
            type: "error",
            msg: err instanceof Error ? err.message : String(err),
          });
        }
      })();
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
    const pending = computePersonaBootstrapPending(harness);
    const allowSkip = personaBootstrapAllowSkipFromHarness(harness);
    dispatch({ type: "session_reset", personaBootstrap: { pending, allowSkip } });
    bootstrapPendingRef.current = pending;
    void (async () => {
      try {
        const persisted = harness.getPersistedPersonaProfile();
        if (persisted) {
          await applyPersonaProfileToHarness(harness, persisted);
        }
        if (pending) return;
        await harness.sendSessionGreeting();
      } catch (err) {
        dispatch({
          type: "error",
          msg: err instanceof Error ? err.message : String(err),
        });
      }
    })();
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
    submitPersonaBootstrap,
    resolveApproval,
    resolveAskUser,
    dismissApprovalUi,
    dismissAskUserUi,
    clearSession,
  };
}
