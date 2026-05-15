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
