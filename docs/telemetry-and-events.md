# Telemetry and Events

Liminal emits structured runtime events through the harness emitter. These power UI rendering, eval traces, and observability.

## Core Event Categories

- conversation: `text`, `error`, `turn_end`
- tool lifecycle: `tool_start`, `tool_delta`, `tool_approval`, `tool_result`, `tool_timing`
- orchestration: `subtask_spawned`, `subtask_output`, `subtask_complete`
- context/runtime: `context_compressed`, `persona_changed`

## Long-Horizon Runtime Events

- `execution_state`
- `contract_transition`
- `contract_violation`
- `recovery_action`
- `drift_detected`
- `runtime_heartbeat`
- `vault_activity`

These events make long-run behavior inspectable and testable.

## Turn-End Metrics

`turn_end` includes `harnessMetrics`, commonly containing:
- tools invoked this send
- spawn call count
- parallel batch size
- working-state preview
- epistemic state snapshot
- execution state snapshot
- vault metrics

## Event Semantics Guidance

- **heartbeat**: per-round health signal, not success indicator
- **drift_detected**: policy-level drift observation; may or may not trigger replan
- **contract_violation**: pre-dispatch policy block
- **vault_activity**: advisory and write/read/search telemetry, includes skips/reasons

## Consumers

- TUI reducer
- Web SSE reducer
- Eval trace capture
- external logs (if session/eval sinks are enabled)

## Operational Practice

- treat event ordering as part of UI correctness
- preserve backwards compatibility for event payload fields where possible
- add new events with matching eval assertions to avoid silent regressions

