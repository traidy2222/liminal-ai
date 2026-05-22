# UI Streaming and Rendering

How TUI and web render harness events, and how to debug “stuck” or garbled UI.

## Stream Normalization

Core streaming sanitization removes common malformed glyph patterns from token deltas before UI rendering.

## Event Ordering

High-throughput streams can interleave text and structural events (tool cards, traces, retries).

Mitigation:
- queue text/trace deltas briefly
- flush buffered deltas before structural events (`tool_start`, `tool_result`, etc.)
- maintain channel separation (`user` vs `trace`)

## Web: SSE and busy state

Client: `packages/web/client/useSSE.ts`. Server: `packages/web/server/sse.ts`.

### Transport vs API vs HUD “STANDBY”

Treat these separately:

| Layer | Signal | Typical meaning |
|-------|--------|-----------------|
| **REST `/api/status`** | `busy`, `lastTurnEndedAt`, `clients` | Express up; harness may be mid-turn even when SSE hiccups. |
| **SSE `/api/stream`** | `connected`, `sseTransport`, `sseTransportDetail` | Live event delivery; reconnects briefly during API restarts or `web:dev` proxy `ECONNRESET`. |
| **HUD orb “STANDBY”** | `idle`, not necessarily broken | Idle between turns — not diagnostics for crashes. |

**Client behaviour (web):**

- **CONNECTING** / **WAIT API** appears before the first successful SSE handshake (`sseHasOpenedOnce`); REST may already be reachable.
- **DEGRADED** means **`/api/status` OK** while the EventSource layer is **`reconnecting` / `offline`**, including when the harness is **`busy`** (copy notes that events may pause).
- **OFFLINE** means **`/api/status`** could not be reached — kill `:3001`, wrong proxy target, VPN, firewall, etc.
- **Busy stall watchdog**: if `busy` and there are **no streamed assistant/tool events** (tokens, tool cards, subtask lines, etc.) for ~52s, a **`[UI]`** trace fires; it repeats about every 4 minutes while the stall continues. Periodic `harness_running` alone does not reset this timer — it only proves the SSE socket is warm. Use RAW for trace lines when `AGENT_UI_VERBOSITY=quiet`.
- **`web:dev`** (Vite on `:5173` proxying to Express `:3001`) often logs **`http proxy error ... ECONNRESET`** when Express restarts; the UI probes `/api/status` on SSE interruption so SIGNAL does not jump straight to misleading OFFLINE when the API is still healthy.

### `turn_end` and “stuck processing”

Symptom: trace shows `[UI] Server reports idle — cleared stuck "processing"` or the composer stays disabled after a long turn.

Causes:
- Very large RAW transcripts delaying `turn_end` delivery
- SSE reconnect missing a single `turn_end` event
- Heavy parallel tools (e.g. several `web_fetch` or hung `read_artifact` attempts)

Mitigations (client):
- Track **expected** `turn_end` after each user send
- Poll `GET /api/status` with **consecutive idle** samples + grace period before forcing idle
- Compare server **`lastTurnEndedAt`** (set on `turn_end` in `agentBridge`) before unlocking UI

Mitigations (operator):
- Rebuild `core`/`tools` and restart web after harness changes
- Avoid calling `read_artifact` when distill/elide are off — see [Troubleshooting](../operations/troubleshooting.md)
- Cap parallel slow `web_fetch` — see [Research with web tools](../guides/research-with-web-tools.md)

### Session bootstrap

`GET /api/config`, `POST /api/message`, and `POST /api/persona/bootstrap` await **`whenSessionReady()`** so early requests do not race harness init. See [Web API](../reference/web-api.md).

## TUI Rendering Model

Reducer-driven message list, bounded window, stable modal heights — `packages/tui/src/useAgent.ts`.

## Common Artifact Patterns

1. **Channel bleed**: trace/user text inside tool lines
2. **Fragment splits**: malformed glyph separators
3. **Repaint flicker**: frequent tiny updates
4. **Stale tool cards**: `tool_start` without matching `tool_result` after crash — refresh session

## Debug flow

1. Confirm artifact origin (model text vs UI composition)
2. Inspect SSE event sequence around corruption (`RAW` toggle in web)
3. Verify `turn_end` and `/api/status` alignment
4. Test with `AGENT_UI_VERBOSITY=quiet` to reduce trace noise

API reference: [Web API](../reference/web-api.md).
