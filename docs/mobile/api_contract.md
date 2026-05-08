# Mobile API Contract (Android)

This document defines the baseline mobile contract for a native Android client against the harness web bridge.

## Current Server Endpoints

Source of truth today:
- `packages/web/server/routes.ts`
- `packages/web/server/sse.ts`
- `packages/web/server/agentBridge.ts`

### HTTP Routes

- `GET /api/config`
  - Response: `{ uiVerbosity, approvalTimeoutMs }`
- `POST /api/session/reset`
  - Response: `{ ok: true }` or `409 { error }` when busy
- `GET /api/stream`
  - SSE stream with event replay support via `Last-Event-ID`
- `POST /api/message`
  - Body: `{ message?, freshContext?, attachments? }`
  - Response: `{ ok: true }` or error (`400/409/500`)
- `POST /api/approve`
  - Body: `{ callId, decision }`
- `POST /api/answer`
  - Body: `{ answer }`
- `GET /api/status`
  - Response: `{ clients }`

### SSE Event Names

Core:
- `connected`, `text`, `turn_end`, `error`

Tool lifecycle:
- `tool_start`, `tool_delta`, `tool_approval`, `tool_result`

User interaction:
- `ask_user`

Subtasks:
- `subtask_spawned`, `subtask_complete`, `subtask_output`

Diagnostics/runtime:
- `provider_retry`, `context_compressed`, `persona_changed`
- `execution_state`, `contract_transition`, `contract_violation`
- `recovery_action`, `drift_detected`, `runtime_heartbeat`, `vault_activity`
- `runtime_pref_detected`, `runtime_pref_changed`, `runtime_pref_persisted`, `runtime_pref_rejected`
- `ask_user_answered`, `approval_decision`, `tool_timing`

## Required Backend Deltas for Mobile

Planned additions for production mobile rollout:

1. Auth/session
   - `POST /api/mobile/auth/login`
   - `POST /api/mobile/auth/refresh`
   - `POST /api/mobile/device/register`

2. Conversation retrieval
   - `GET /api/mobile/conversations?cursor=...`
   - `GET /api/mobile/conversations/:id/messages`

3. Stream resume
   - `GET /api/mobile/stream-token`
   - Resume token to continue stream after app restarts.

4. Push hooks
   - server-to-FCM fanout for turn completion, approval requests, and failures.

5. Upload flow optimization
   - optionally replace base64-in-message POST with direct upload endpoint:
     - `POST /api/mobile/attachments`
     - returns persisted artifact references.

## Mobile Client Reliability Rules

- Always connect SSE with `Last-Event-ID` when reconnecting.
- Persist last seen event id per conversation session.
- Treat `409` from `/api/message` as non-fatal busy state.
- Keep user draft intact on non-2xx send failures.
