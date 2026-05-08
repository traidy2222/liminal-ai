export interface MobileApiConfigResponse {
  uiVerbosity: "normal" | "quiet";
  approvalTimeoutMs: number;
}

export interface MobileApiStatusResponse {
  clients: number;
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
  | "/api/status";

export type MobileSseEventName =
  | "connected"
  | "text"
  | "provider_retry"
  | "tool_start"
  | "tool_delta"
  | "tool_approval"
  | "tool_result"
  | "ask_user"
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

export interface MobileSseEnvelope<T = unknown> {
  id: number;
  event: MobileSseEventName;
  data: T;
}

export const MOBILE_CONTRACT_VERSION = "2026-05-08.mobile.v1";
