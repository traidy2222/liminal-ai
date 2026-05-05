# Architecture

This document describes Liminal's runtime architecture and core invariants.

## System Topology

Primary packages:

- `packages/core`: harness engine, dispatcher, context, orchestration, world context
- `packages/tools`: tool definitions, registration, protocol text, tool catalogs
- `packages/tui`: Ink-based terminal UI
- `packages/web`: Express + SSE bridge + React client
- `packages/eval`: scenario runner and assertion packs

Dependency graph:

```text
core  -> compiled dist
tools -> depends on core dist
tui   -> depends on core/tools dist
web   -> depends on core/tools dist
eval  -> depends on core/tools dist
```

Build order is mandatory: `core` then `tools`.

## ReAct Lifecycle

At a high level, `AgentHarness.send()`:

1. Initializes per-turn runtime counters and state.
2. Injects world context once per root session.
3. Streams model deltas and tool calls.
4. Executes tool batches through `ToolDispatcher`.
5. Appends tool output to conversation context.
6. Applies drift/recovery logic and optional critic/finalization passes.
7. Emits `turn_end` with runtime metrics.

Liminal does not use a hard wall-clock kill for root `send()`; it relies on bounded rounds, error controls, and recovery logic.

## Tool Dispatcher Contract

`ToolDispatcher` enforces:

1. JSON parse
2. schema validation
3. argument guardrails
4. policy gates (pre-dispatch)
5. destructive preflight
6. resource lock acquisition
7. approval/safety-judge path
8. tool execution
9. telemetry emission
10. lock release

This contract ensures identical safety semantics regardless of tool implementation details.

## Resource Locking and Concurrency

`ResourceLockManager` coordinates resource locks (files, shell domains, etc.) across parent and child agents.

- lock ordering is deterministic
- lock contention returns structured errors
- lock release occurs in finally paths

This prevents race conditions in parallel tool execution.

## Child Agent Orchestration

Parent harnesses can spawn child harnesses via orchestration tools.

Invariants:

- harness-scoped tools are recreated per child (never shared closures)
- children share orchestrator infrastructure but maintain scoped context/runtime state
- grandchildren obey depth and concurrency constraints

## Context and Budget Management

`ContextManager` tracks:

- token usage fraction
- compression thresholds
- working-state hints
- optional output distillation references

Compression summarizes older rounds while preserving actionable state.

## Key Runtime State Models

Two major state tracks:

- **Epistemic state**: goals, subgoals, files touched, open questions, budget hints
- **Execution state**: mission, milestones, contracts, commitments, drift score, recovery log

Execution state powers long-horizon coherence and anti-drift behavior.

## Event Surfaces

The harness emits events for:

- text streaming
- tool lifecycle (`tool_start`, `tool_delta`, `tool_result`)
- orchestration (`subtask_`*)
- context events
- execution-state events
- drift/recovery signals
- vault activity

See `docs/telemetry-and-events.md` for payload-level detail.