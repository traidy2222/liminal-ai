/**
 * Mobile API + SSE contract v2 — typed payloads aligned with AgentEventMap bridge allowlist.
 */
import type {
  TurnSummary,
  TurnEndHarnessMetrics,
  ContextSnapshot,
} from "@liminal/core";

export interface MobileApiConfigResponse {
  uiVerbosity: "normal" | "quiet";
  approvalTimeoutMs: number;
}

export interface MobileApiStatusResponse {
  clients: number;
  /** True while a send()/ReAct loop is in progress. */
  busy: boolean;
  startedAt?: number | null;
  /** Server timestamp of last turn_end (ms since epoch). */
  lastTurnEndedAt?: number | null;
}

export interface MobileIncomingAttachment {
  name?: string;
  dataUrl?: string;
  source?: "clipboard" | "drop" | "path" | "command" | "camera" | "gallery";
}

export interface MobileMessageRequest {
  message?: string;
  freshContext?: boolean;
  attachments?: MobileIncomingAttachment[];
}

export interface MobileOkResponse {
  ok: boolean;
}

export interface MobileErrorResponse {
  error: string;
}

export interface MobileApprovalRequest {
  callId: string;
  decision: {
    decision: "approve" | "reject";
    reason?: string;
  };
}

export interface MobileAskAnswerRequest {
  answer: string;
}

export type MobileApiRoutes =
  | "/api/config"
  | "/api/stream"
  | "/api/message"
  | "/api/approve"
  | "/api/answer"
  | "/api/session/reset"
  | "/api/session/abort"
  | "/api/status";

/** SSE events bridged to mobile clients (subset of AgentEventMap). */
export type MobileSseEventName =
  | "connected"
  | "text"
  | "provider_retry"
  | "tool_start"
  | "tool_delta"
  | "tool_approval"
  | "tool_result"
  | "ask_user"
  | "turn_summary"
  | "turn_end"
  | "error"
  | "subtask_spawned"
  | "subtask_complete"
  | "subtask_output"
  | "context_compressed"
  | "persona_changed"
  | "runtime_pref_detected"
  | "runtime_pref_changed"
  | "runtime_pref_persisted"
  | "runtime_pref_rejected"
  | "execution_state"
  | "contract_transition"
  | "contract_violation"
  | "recovery_action"
  | "drift_detected"
  | "runtime_heartbeat"
  | "vault_activity"
  | "ask_user_answered"
  | "approval_decision"
  | "tool_timing";

/** Per-event payload map for typed mobile consumers. */
export interface MobileSsePayloadMap {
  connected: { clientId?: string };
  text: { delta: string; channel?: "user" | "trace" | "reasoning" };
  provider_retry: { attempt: number; maxAttempts: number; message: string; backoffMs: number };
  tool_start: { callId: string; name: string };
  tool_delta: { callId: string; argsDelta: string };
  tool_approval: { callId: string; name: string; args: Record<string, unknown>; approvalTimeoutMs: number };
  tool_result: { callId: string; name: string; args: Record<string, unknown>; ok: boolean; output: string };
  ask_user: { prompt: string };
  turn_summary: TurnSummary;
  turn_end: {
    contextSnapshot: ContextSnapshot;
    durationMs?: number;
    harnessMetrics?: TurnEndHarnessMetrics;
    traceId?: string;
  };
  error: { message: string };
  tool_timing: { callId: string; name: string; durationMs: number };
  execution_state: {
    missionId?: string;
    activeContractId?: string;
    driftScore?: number;
    milestoneCount?: number;
    contractCount?: number;
  };
  [key: string]: unknown;
}

export interface MobileSseEnvelope<E extends MobileSseEventName = MobileSseEventName> {
  id: number;
  event: E;
  data: E extends keyof MobileSsePayloadMap ? MobileSsePayloadMap[E] : unknown;
}

export const MOBILE_CONTRACT_VERSION = "2026-05-23.mobile.v2";
