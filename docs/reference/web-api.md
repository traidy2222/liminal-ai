# Web API (Express)

Base URL: `http://localhost:PORT` (default **3001**). Static UI from `packages/web/client/dist` when built.

## Authentication

The local server is **token-gated** (`packages/web/server/local_auth.ts`). Every request must
present the web token via `Authorization: Bearer <token>`, an `x-liminal-token` header, or an
`authToken` query param. The token is generated on first run and stored at `~/.liminal/web_token`
(`0600`), or set explicitly with `AGENT_WEB_TOKEN`. The client reads it from
`GET /api/config`, which is **exempt only from loopback** (`127.0.0.1`). The Vireon auth
callback (`/api/vireon/auth/callback`) is also exempt so the browser sign-in redirect can land.

Bind host defaults to `127.0.0.1` (`AGENT_WEB_BIND_HOST`); extra CORS origins via
`AGENT_WEB_CORS_ORIGINS`.

## Session and config

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/config` | UI verbosity, approval timeout, persona bootstrap flags, `personaUiTheme`, `personaDisplayLabel`, heartbeat flags. **Awaits** `whenSessionReady()`. |
| `GET` | `/api/status` | Harness busy/idle, optional `lastTurnEndedAt` for client busy reconciliation |
| `POST` | `/api/session/reset` | New session / harness reset (`mode: soft \| hard`, optional `greet`) |
| `POST` | `/api/session/abort` | Abort the in-progress turn (**409** if idle) |

## Settings

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/settings` | Tabs + fields from `buildHarnessSettingsApiFields`; provider model/base URL summary (no API keys) |
| `PUT` | `/api/settings` | Patch `harness.env` and/or provider model/baseURL into `.agent_runtime_prefs.json`. **409** if agent is mid-turn |

Locked fields: keys set in real `process.env` cannot be overridden via PUT. `PUT` also accepts
`provider.inferenceMode` (`byok` \| `managed` \| `auto`).

## Vireon account, licensing &amp; managed inference

Browser sign-in, license/account state, and managed-inference usage. See
[Accounts &amp; licensing](../guides/accounts-and-licensing.md) and
[Managed inference](../guides/managed-inference.md).

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/vireon/account` | Connected account, tier, entitlements, licensed flag |
| `GET` | `/api/vireon/connect/begin` | Start loopback sign-in — returns `connectUrl` + `state` |
| `GET`/`POST` | `/api/vireon/auth/callback` | Receives the signed license token (auth-exempt) |
| `POST` | `/api/vireon/logout` | Clear local license + account |
| `POST` | `/api/vireon/reconnect` | Re-apply provider/inference config after sign-in (**409** if busy) |
| `GET` | `/api/vireon/inference-status` | Managed-inference wallet: remaining/cap/used credits, period end |

## Multi-chat

Each chat has its own workspace, memory, and session. Endpoints resolve the **active** chat;
switch with `activate`. See `packages/web/server/chatManager.ts`.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/chats` | List chats + orphan ids + active/resident ids |
| `POST` | `/api/chats` | Create a chat (`workspaceMode: scratch \| folder \| reuse`) |
| `GET` | `/api/chats/:id` | Chat metadata |
| `POST` | `/api/chats/:id/activate` | Make a chat the active SSE target |
| `DELETE` | `/api/chats/:id` | Delete a chat (returns `newActiveId`) |
| `GET` | `/api/workspace/current` | Active chat's workspace root + fingerprint |

## Audio: transcription &amp; TTS

See [Voice](../guides/voice.md). Audio is sent as base64 data URLs (no multer dependency).

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/audio/upload` | Persist an audio clip under the chat → returns `attachmentId` |
| `POST` | `/api/transcribe` | Run ASR on a previously uploaded clip |
| `POST` | `/api/tts` | Synthesize speech (segmented); returns clip ids + cost |
| `GET` | `/api/tts/clip/:clipId` | Fetch a synthesized clip's audio bytes |

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
