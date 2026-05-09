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

### Task DAG scheduling

`spawn_agent` accepts an optional `depends_on` array of task IDs. The orchestrator stores these as `TaskRecord.dependsOn` and exposes two resolution methods:

- `waitForDependencies(taskId, timeoutMs)` — async poll until all upstream tasks reach terminal state; returns `{ok, failedIds}`.
- `dependenciesMet(taskId)` — synchronous snapshot check.

This enables parallel-with-sequential patterns: spawn A and B in parallel, spawn C with `depends_on: [A, B]` and C will not start until both complete.

### Shared memory bus

`SharedMemoryBus` is created once on the root harness and propagated to every child via `forkChild`. Sub-agents can `publish(key, value, publisherId)` facts and `read` each other's output without routing through the parent's conversation history. Subscribers receive synchronous notifications on every write. The bus is in-process only and not persisted to disk.

### New orchestration tools

- `decompose_goal(goal, context?, max_nodes?)` — calls the configured model to break a high-level goal into a typed node/edge DAG. Nodes carry `agent_role` hints ready for use as `system_prompt` in `spawn_agent`.
- `branch_explore(question, approach_a, approach_b, context?)` — spawns two read-only critic sub-agents with divergent angles, waits for both, then uses the model as a judge to pick the winner or synthesise both.
- `verify_contract(mark_done?, goal_summary?)` — reads `ExecutionState` and renders a structured report: mission, milestones, active contract budget, drift score, commitments, recovery log.

All three are harness-scoped (close over the harness instance), listed in `ORCHESTRATION_TOOL_NAMES`, and re-created per child in `onChildCreated`.

## Context and Budget Management

`ContextManager` tracks:

- token usage fraction
- compression thresholds
- working-state hints
- optional output distillation references

Compression summarizes older rounds while preserving actionable state. When `AGENT_COMPRESS_SEMANTIC=1`, a `semanticSummarizer` callback is wired at construction time; `compressOldRounds` awaits it to produce a causal narrative digest instead of raw tool-name one-liners.

`buildMessages()` is async to support the semantic summarizer. `buildMessagesSync()` is the synchronous sibling used for token counting only (by `snapshot()` and `getContextBudgetAdvice()`).

## Key Runtime State Models

Two major state tracks:

- **Epistemic state**: goals, subgoals, files touched, open questions, budget hints
- **Execution state**: mission, milestones, contracts, commitments, drift score, recovery log

Execution state powers long-horizon coherence and anti-drift behavior.

## Rule Effectiveness Tracking

Named R-* protocol rules (e.g. `R-PLAN-3STEPS`, `R-CITE-PATHS`) accumulate hit counts and errors-prevented counts in `.agent_rule_stats.json` at the workspace root.

- `extractRuleIds(text)` — regex extracts all `R-UPPERCASE` IDs from any string.
- `bumpRuleHits(context, preventedError)` — increments counters for each rule ID found in the context; called automatically after structured reflexion on failure rounds.
- `formatRuleStatsReport(topN)` — returns a ranked leaderboard string for world context injection or eval output.

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