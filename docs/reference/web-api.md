# Web API (Express)

Base URL: `http://localhost:PORT` (default **3001**). Static UI from `packages/web/client/dist` when built.

## Session and config

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/config` | UI verbosity, approval timeout, persona bootstrap flags, `personaUiTheme`, `personaDisplayLabel`, heartbeat flags. **Awaits** `whenSessionReady()`. |
| `GET` | `/api/status` | Harness busy/idle, optional `lastTurnEndedAt` for client busy reconciliation |
| `POST` | `/api/session/reset` | New session / harness reset |

## Settings

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/settings` | Tabs + fields from `buildHarnessSettingsApiFields`; provider model/base URL summary (no API keys) |
| `PUT` | `/api/settings` | Patch `harness.env` and/or provider model/baseURL into `.agent_runtime_prefs.json`. **409** if agent is mid-turn |

Locked fields: keys set in real `process.env` cannot be overridden via PUT.

## Messaging and approvals

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/message` | User message (+ optional image attachments). Awaits session ready. |
| `POST` | `/api/approve` | Tool approval decision |
| `POST` | `/api/answer` | `ask_user` response |
| `POST` | `/api/persona/bootstrap` | Persona bootstrap completion payload. Awaits session ready. |

## SSE

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/stream` | Server-Sent Events: `text`, `tool_*`, `turn_end`, `harness_running`, etc. |

Client: `packages/web/client/useSSE.ts`. Reconnect via `Last-Event-ID`; buffer while disconnected.

**Busy state:** Client tracks expected `turn_end`, polls `/api/status`, uses `lastTurnEndedAt` before clearing “processing” after missed events. See [UI streaming](../concepts/ui-streaming.md).

## Implementation

- Routes: `packages/web/server/routes.ts`
- Bridge: `packages/web/server/agentBridge.ts`
- SSE: `packages/web/server/sse.ts`

The web UI is the supported client for chat, approvals, and SSE streaming on desktop and mobile browsers.
